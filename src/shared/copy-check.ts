import type { Declaration } from "./declarations.ts";
import type { CopyRules } from "./safety.ts";

export interface ContentSource {
  url: string;
  title: string;
  text: string;
}

export const SOURCE_TEXT_MAX = 30000;
const GRAM = 3;
const MIN_GRAMS = 20;

const normalize = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");

function grams(text: string) {
  const chars = Array.from(normalize(text));
  const out = new Set<string>();
  for (let i = 0; i + GRAM <= chars.length; i++) out.add(chars.slice(i, i + GRAM).join(""));
  return out;
}

export function copyRatio(current: string, source: string) {
  const mine = grams(current);
  if (mine.size < MIN_GRAMS) return 0;
  const theirs = grams(source);
  let same = 0;
  for (const g of mine) if (theirs.has(g)) same++;
  return same / mine.size;
}

export interface CopyVerdict {
  ratio: number;
  block: boolean;
  noOriginal: boolean;
  warn: boolean;
}

export function copyVerdict(rules: CopyRules, current: string, source: ContentSource | undefined, declaration: Declaration | undefined): CopyVerdict | undefined {
  if (!source?.text) return undefined;
  const ratio = copyRatio(current, source.text);
  return {
    ratio,
    block: ratio >= rules.blockAt && declaration !== "repost",
    noOriginal: ratio >= rules.noOriginalAt,
    warn: ratio >= rules.warnAt,
  };
}

export const percent = (r: number) => Math.round(r * 100) + "%";

export function parseSource(value: unknown): ContentSource | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.url !== "string" || typeof v.text !== "string") return undefined;
  return { url: v.url.slice(0, 500), title: typeof v.title === "string" ? v.title.slice(0, 200) : "", text: v.text.slice(0, SOURCE_TEXT_MAX) };
}
