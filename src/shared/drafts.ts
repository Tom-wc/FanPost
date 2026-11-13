import type { DraftOverride, Platform, SavedDraft } from "./types.ts";
import { platforms as platformDefs } from "./platforms.ts";
import { DEFAULT_DECLARATION, isDeclaration, type Declaration } from "./declarations.ts";
import { parseSource } from "./copy-check.ts";

export type DraftInput = Omit<SavedDraft, "id" | "createdAt" | "updatedAt">;
export interface ComposerSnapshot {
  media: string[];
  cover?: string;
  title: string;
  description: string;
  topics: string[];
  overrides: Partial<Record<Platform, DraftOverride>>;
  declaration?: Declaration;
  original?: boolean;
}

const platformIds = new Set<string>(platformDefs.map((p) => p.id));
const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const isString = (v: unknown): v is string => typeof v === "string";
const strings = (v: unknown) => (Array.isArray(v) ? v.filter(isString) : []);

function parseOverrides(value: unknown): Partial<Record<Platform, DraftOverride>> {
  if (!isRecord(value)) return {};
  const out: Partial<Record<Platform, DraftOverride>> = {};
  for (const [platform, raw] of Object.entries(value)) {
    if (!platformIds.has(platform) || !isRecord(raw)) continue;
    out[platform as Platform] = {
      enabled: raw.enabled === true,
      ...(isString(raw.title) ? { title: raw.title } : {}),
      ...(isString(raw.description) ? { description: raw.description } : {}),
      ...(Array.isArray(raw.topics) ? { topics: strings(raw.topics) } : {}),
      ...(isString(raw.coverPath) && raw.coverPath ? { coverPath: raw.coverPath } : {}),
      ...(isString(raw.question) && raw.question.trim() ? { question: raw.question } : {}),
      ...(isString(raw.zone) && raw.zone.trim() ? { zone: raw.zone } : {}),
    };
  }
  return out;
}

export function parseDraftInput(value: unknown): DraftInput | undefined {
  if (!isRecord(value) || (value.type !== "video" && value.type !== "image_text")) return undefined;
  return {
    type: value.type,
    title: isString(value.title) ? value.title : "",
    description: isString(value.description) ? value.description : "",
    topics: strings(value.topics),
    mediaPaths: strings(value.mediaPaths),
    ...(isString(value.coverPath) && value.coverPath ? { coverPath: value.coverPath } : {}),
    accountIds: strings(value.accountIds),
    overrides: parseOverrides(value.overrides),
    ...(isDeclaration(value.declaration) ? { declaration: value.declaration } : {}),
    ...(value.original === true ? { original: true } : {}),
    ...(parseSource(value.source) ? { source: parseSource(value.source) } : {}),
    ...(typeof value.scheduledAt === "string" && value.scheduledAt && !Number.isNaN(Date.parse(value.scheduledAt)) ? { scheduledAt: value.scheduledAt } : {}),
  };
}

export function parseSavedDrafts(value: unknown): SavedDraft[] {
  if (!Array.isArray(value)) return [];
  const out: SavedDraft[] = [];
  for (const raw of value) {
    const input = parseDraftInput(raw);
    if (!input || !isRecord(raw) || !isString(raw.id)) continue;
    const createdAt = isString(raw.createdAt) ? raw.createdAt : new Date(0).toISOString();
    out.push({ ...input, id: raw.id, createdAt, updatedAt: isString(raw.updatedAt) ? raw.updatedAt : createdAt });
  }
  return out;
}

export function upsertDraft(list: SavedDraft[], input: DraftInput, id: string, now: string): SavedDraft[] {
  const old = list.find((d) => d.id === id);
  const next: SavedDraft = { ...input, id, createdAt: old?.createdAt ?? now, updatedAt: now };
  return [next, ...list.filter((d) => d.id !== id)];
}

export function snapshotKey(s: ComposerSnapshot): string {
  const overrides = Object.entries(s.overrides)
    .filter(([, o]) => o)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([s.media, s.cover ?? "", s.title, s.description, s.topics, overrides, s.declaration ?? DEFAULT_DECLARATION, !!s.original]);
}

export const BLANK_SNAPSHOT: ComposerSnapshot = { media: [], title: "", description: "", topics: [], overrides: {} };

export const draftLabel = (d: Pick<SavedDraft, "title" | "description">) =>
  d.title.trim() || d.description.trim().slice(0, 20) || "未命名草稿";
