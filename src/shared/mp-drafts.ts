import { parseSource, type ContentSource } from "./copy-check.ts";
import { MP_RULES } from "./mp-rules.ts";
import { htmlFromText } from "./mp-html.ts";

export interface MpAttachmentRef {
  name: string;
  file: string;
  size: number;
}

export interface MpDraft {
  id: string;
  title: string;
  author: string;
  digest: string;
  text: string;
  html: string;
  images: string[];
  cover?: string;
  sourceUrl: string;
  openComment: boolean;
  repost?: boolean;
  attachments?: MpAttachmentRef[];
  source?: ContentSource;
  mediaId?: string;
  savedToMpAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type MpDraftInput = Omit<MpDraft, "id" | "createdAt" | "updatedAt" | "mediaId" | "savedToMpAt">;

const MP_HTML_MAX = 2 * 1024 * 1024;
const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const s = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export function parseMpDraftInput(v: unknown): MpDraftInput | undefined {
  if (!isRecord(v)) return undefined;
  const images = Array.isArray(v.images) ? v.images.filter((x): x is string => typeof x === "string").slice(0, MP_RULES.imagesMax) : [];
  const source = parseSource(v.source);
  const attachments = (Array.isArray(v.attachments) ? v.attachments : []).filter((x): x is MpAttachmentRef => isRecord(x) && typeof x.name === "string" && typeof x.file === "string" && typeof x.size === "number").slice(0, 20).map((x) => ({ name: x.name.slice(0, 120), file: x.file.slice(0, 500), size: x.size }));
  return {
    title: s(v.title, 200),
    author: s(v.author, 40),
    digest: s(v.digest, 400),
    text: s(v.text, 60000),
    html: typeof v.html === "string" && v.html.trim() ? v.html.slice(0, MP_HTML_MAX) : htmlFromText(s(v.text, 60000), images),
    images,
    ...(typeof v.cover === "string" && v.cover ? { cover: v.cover } : {}),
    sourceUrl: s(v.sourceUrl, 500),
    openComment: v.openComment === true,
    ...(v.repost === true ? { repost: true } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(source ? { source } : {}),
  };
}

export function parseMpDrafts(value: unknown): MpDraft[] {
  if (!Array.isArray(value)) return [];
  const out: MpDraft[] = [];
  for (const raw of value) {
    const input = parseMpDraftInput(raw);
    if (!input || !isRecord(raw) || typeof raw.id !== "string") continue;
    const createdAt = s(raw.createdAt, 40) || new Date(0).toISOString();
    out.push({
      ...input,
      id: raw.id,
      ...(typeof raw.mediaId === "string" && raw.mediaId ? { mediaId: raw.mediaId } : {}),
      ...(typeof raw.savedToMpAt === "string" && raw.savedToMpAt ? { savedToMpAt: raw.savedToMpAt } : {}),
      createdAt,
      updatedAt: s(raw.updatedAt, 40) || createdAt,
    });
  }
  return out;
}

export function upsertMpDraft(list: MpDraft[], input: MpDraftInput, id: string, now: string): MpDraft[] {
  const old = list.find((d) => d.id === id);
  const next: MpDraft = { ...input, id, createdAt: old?.createdAt ?? now, updatedAt: now, ...(old?.mediaId ? { mediaId: old.mediaId, savedToMpAt: old.savedToMpAt } : {}) };
  return [next, ...list.filter((d) => d.id !== id)];
}

export const BLANK_MP: MpDraftInput = { title: "", author: "", digest: "", text: "", html: "", images: [], sourceUrl: "", openComment: true };
