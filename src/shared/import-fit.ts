import type { Account, DraftOverride, Platform } from "./types.ts";
import { platformRule, supportsType, titleLength } from "./platform-rules.ts";

const SENTENCE_END = /[。！？!?；;…]/;
const MIN_KEEP = 0.6;
const ELLIPSIS = "…";

export function cutText(text: string, max: number) {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const head = chars.slice(0, max - 1);
  for (let i = head.length - 1; i >= Math.floor(max * MIN_KEEP); i--) {
    if (head[i] === "\n" || SENTENCE_END.test(head[i])) return head.slice(0, i + 1).join("").trim();
  }
  return head.join("").trim() + ELLIPSIS;
}

export function cutTitle(title: string, max: number) {
  const clean = title.replace(/\s+/g, " ").trim();
  if (titleLength(clean) <= max) return clean;
  const parts = clean.split(/[|｜\-—_:：,，·]/).map((p) => p.trim()).filter(Boolean);
  const best = parts.find((p) => titleLength(p) <= max && titleLength(p) >= Math.min(6, max));
  return best || Array.from(clean).slice(0, max).join("");
}

export interface FitResult {
  title: string;
  images: string[];
  overrides: Partial<Record<Platform, DraftOverride>>;
  notes: string[];
}

export const COMMON_IMAGE_MAX = 18;

export function fitImport(input: { title: string; text: string; images: string[] }, platforms: Platform[]): FitResult {
  const notes: string[] = [];
  const images = input.images.slice(0, COMMON_IMAGE_MAX);
  if (input.images.length > images.length) notes.push("图片 " + input.images.length + " 张，按小红书和微博的上限只留前 " + COMMON_IMAGE_MAX + " 张");
  const title = input.title.replace(/\s+/g, " ").trim();
  const overrides: Partial<Record<Platform, DraftOverride>> = {};
  const fixed: string[] = [];
  for (const p of platforms) {
    const rule = platformRule(p, "image_text");
    const titleMax = rule.mergeTitleIntoBody ? undefined : rule.titleMax;
    const bodyMax = rule.bodyMax !== undefined && rule.mergeTitleIntoBody ? rule.bodyMax - titleLength(title) - 1 : rule.bodyMax;
    const t = titleMax !== undefined && titleLength(title) > titleMax ? cutTitle(title, titleMax) : undefined;
    const b = bodyMax !== undefined && titleLength(input.text) > bodyMax ? cutText(input.text, Math.max(50, bodyMax)) : undefined;
    if (t === undefined && b === undefined) continue;
    overrides[p] = { enabled: true, title: t ?? title, description: b ?? input.text };
    fixed.push(p);
  }
  if (fixed.length) notes.push(fixed.length + " 个平台的标题或正文超出上限，已在对应平台标签页里自动生成缩短版，请检查");
  return { title, images, overrides, notes };
}

export function importPlatforms(accounts: Pick<Account, "id" | "platform">[], selected: string[] | undefined) {
  const usable = accounts.filter((a) => supportsType(a.platform, "image_text"));
  const ids = selected === undefined ? usable.map((a) => a.id) : selected.filter((id) => usable.some((a) => a.id === id));
  return { accountIds: ids, platforms: Array.from(new Set(usable.filter((a) => ids.includes(a.id)).map((a) => a.platform))) };
}
