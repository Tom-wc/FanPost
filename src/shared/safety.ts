import type { Platform } from "./types.ts";
import { platforms } from "./platforms.ts";

export type WordLevel = "block" | "warn";

export interface WordRule {
  pattern: string;
  regex?: boolean;
  category: string;
  level: WordLevel;
  platforms?: Platform[];
  hint?: string;
}

export interface PacingRules {
  dailyDefault: number;
  daily: Partial<Record<Platform, number>>;
  newAccountDays: number;
  newAccountDaily: number;
  minGapMin: number;
}

export interface CopyRules {
  blockAt: number;
  noOriginalAt: number;
  warnAt: number;
}

export interface SafetyRules {
  version: string;
  words: WordRule[];
  pacing: PacingRules;
  copy: CopyRules;
}

const platformIds = new Set<string>(platforms.map((p) => p.id));
const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const intIn = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const ratio = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
};

export const PACING_FALLBACK: PacingRules = { dailyDefault: 5, daily: {}, newAccountDays: 7, newAccountDaily: 2, minGapMin: 3 };
export const COPY_FALLBACK: CopyRules = { blockAt: 0.8, noOriginalAt: 0.3, warnAt: 0.5 };
const MAX_WORDS = 3000;
const MAX_PATTERN = 120;

function validRegex(source: string) {
  try {
    new RegExp(source, "iu");
    return true;
  } catch {
    return false;
  }
}

function parseWord(raw: unknown): WordRule | undefined {
  if (!isRecord(raw) || typeof raw.pattern !== "string") return undefined;
  const pattern = raw.pattern.trim();
  if (!pattern || pattern.length > MAX_PATTERN) return undefined;
  const regex = raw.regex === true;
  if (regex && !validRegex(pattern)) return undefined;
  const level: WordLevel = raw.level === "block" ? "block" : "warn";
  const list = Array.isArray(raw.platforms) ? raw.platforms.filter((p): p is Platform => typeof p === "string" && platformIds.has(p)) : [];
  return {
    pattern,
    ...(regex ? { regex: true } : {}),
    category: typeof raw.category === "string" && raw.category.trim() ? raw.category.trim().slice(0, 20) : "敏感词",
    level,
    ...(list.length ? { platforms: list } : {}),
    ...(typeof raw.hint === "string" && raw.hint.trim() ? { hint: raw.hint.trim().slice(0, 80) } : {}),
  };
}

function parsePacing(raw: unknown): PacingRules {
  const p = isRecord(raw) ? raw : {};
  const daily: Partial<Record<Platform, number>> = {};
  if (isRecord(p.daily)) for (const [k, v] of Object.entries(p.daily)) if (platformIds.has(k)) daily[k as Platform] = intIn(v, 1, 100, PACING_FALLBACK.dailyDefault);
  return {
    dailyDefault: intIn(p.dailyDefault, 1, 100, PACING_FALLBACK.dailyDefault),
    daily,
    newAccountDays: intIn(p.newAccountDays, 0, 60, PACING_FALLBACK.newAccountDays),
    newAccountDaily: intIn(p.newAccountDaily, 1, 100, PACING_FALLBACK.newAccountDaily),
    minGapMin: intIn(p.minGapMin, 0, 120, PACING_FALLBACK.minGapMin),
  };
}

function parseCopy(raw: unknown): CopyRules {
  const c = isRecord(raw) ? raw : {};
  return { blockAt: ratio(c.blockAt, COPY_FALLBACK.blockAt), noOriginalAt: ratio(c.noOriginalAt, COPY_FALLBACK.noOriginalAt), warnAt: ratio(c.warnAt, COPY_FALLBACK.warnAt) };
}

export function parseSafetyRules(value: unknown): SafetyRules | undefined {
  if (!isRecord(value) || !Array.isArray(value.words)) return undefined;
  const words = value.words.slice(0, MAX_WORDS).map(parseWord).filter((w): w is WordRule => !!w);
  return {
    version: typeof value.version === "string" ? value.version.slice(0, 40) : "",
    words,
    pacing: parsePacing(value.pacing),
    copy: parseCopy(value.copy),
  };
}

export interface WordHit {
  platform: Platform;
  field: "title" | "body" | "topics";
  word: string;
  category: string;
  level: WordLevel;
  hint?: string;
}

export interface CheckTarget {
  platform: Platform;
  title: string;
  description: string;
  topics: string[];
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function matcher(rule: WordRule) {
  return new RegExp(rule.regex ? rule.pattern : escapeRegex(rule.pattern), "iu");
}

export function checkWords(rules: SafetyRules, targets: CheckTarget[]): WordHit[] {
  const compiled = rules.words.map((r) => ({ rule: r, re: matcher(r) }));
  const hits: WordHit[] = [];
  const seen = new Set<string>();
  for (const t of targets) {
    const fields: Array<[WordHit["field"], string]> = [["title", t.title], ["body", t.description], ["topics", t.topics.join(" ")]];
    for (const { rule, re } of compiled) {
      if (rule.platforms && !rule.platforms.includes(t.platform)) continue;
      for (const [field, text] of fields) {
        const m = text ? text.match(re) : null;
        if (!m) continue;
        const key = t.platform + "|" + field + "|" + m[0].toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ platform: t.platform, field, word: m[0], category: rule.category, level: rule.level, ...(rule.hint ? { hint: rule.hint } : {}) });
      }
    }
  }
  return hits;
}

export const FIELD_LABELS: Record<WordHit["field"], string> = { title: "标题", body: "正文", topics: "话题" };

export const RULES_STALE_MS = 7 * 86_400_000;
export const RULES_REFRESH_MS = 86_400_000;

export interface RulesPayload {
  keyId: string;
  machine: string;
  issuedAt: string;
  rules: SafetyRules;
}

export function parseRulesPayload(text: string): RulesPayload | undefined {
  try {
    const p = JSON.parse(text) as Record<string, unknown>;
    if (p.kind !== "rules" || typeof p.keyId !== "string" || typeof p.machine !== "string" || typeof p.issuedAt !== "string") return undefined;
    if (Number.isNaN(Date.parse(p.issuedAt))) return undefined;
    const rules = parseSafetyRules(p.rules);
    return rules ? { keyId: p.keyId, machine: p.machine, issuedAt: p.issuedAt, rules } : undefined;
  } catch {
    return undefined;
  }
}

export function usableRules(p: RulesPayload | undefined, keyId: string | undefined, machine: string, now: number) {
  if (!p || !keyId || p.keyId !== keyId || p.machine !== machine) return undefined;
  return now - Date.parse(p.issuedAt) > RULES_STALE_MS ? undefined : p.rules;
}
