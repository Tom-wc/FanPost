import type { Account, Platform, PublishDraft } from "./types.ts";
import type { SafetyRules } from "./safety.ts";
import { FIELD_LABELS, checkWords } from "./safety.ts";
import { pacingBlocks, pacingText, type PublishLogEntry } from "./pacing.ts";
import { copyVerdict, percent, type ContentSource } from "./copy-check.ts";
import { contentFor } from "./platform-rules.ts";
import { platformMap } from "./platforms.ts";
import { accountWho } from "./accounts.ts";

export interface SafetyItem {
  level: "block" | "warn";
  kind: "word" | "pacing" | "copy";
  platform?: Platform;
  accountId?: string;
  text: string;
}

export interface SafetyInput {
  draft: Pick<PublishDraft, "type" | "title" | "description" | "topics" | "overrides" | "declaration" | "original" | "accountIds">;
  accounts: Account[];
  log: PublishLogEntry[];
  source?: ContentSource;
  now: number;
  mp?: boolean;
}

export const RULES_MISSING = "安全规则还没下载到本机（或超过 7 天没更新），请联网后到设置里点「刷新授权」再发布。";

function wordItems(rules: SafetyRules, input: SafetyInput, platforms: Platform[]): SafetyItem[] {
  const targets = platforms.map((p) => ({ platform: p, ...contentFor(input.draft as PublishDraft, p) }));
  return checkWords(rules, targets).map((h) => ({
    level: h.level,
    kind: "word",
    platform: h.platform,
    text: platformMap[h.platform].name + FIELD_LABELS[h.field] + "含「" + h.word + "」（" + h.category + "）" + (h.hint ? "：" + h.hint : ""),
  }));
}

function copyItems(rules: SafetyRules, input: SafetyInput): SafetyItem[] {
  const v = copyVerdict(rules.copy, input.draft.title + "\n" + input.draft.description, input.source, input.draft.declaration);
  if (!v) return [];
  const items: SafetyItem[] = [];
  const head = "和采集原文重合 " + percent(v.ratio);
  if (v.block) items.push({ level: "block", kind: "copy", text: head + "，基本是照搬。请改写，或" + (input.mp ? "打开下面的「内容为转载」，并在「原文链接」里填原文地址" : "把内容声明改成「内容为转载」") });
  else if (v.warn) items.push({ level: "warn", kind: "copy", text: head + "，建议改写后再发，平台可能判为搬运" });
  if (v.noOriginal && input.draft.original) items.push({ level: "block", kind: "copy", text: head + "，不能声明原创，请关掉「声明原创」" });
  return items;
}

export function reviewSafety(rules: SafetyRules, input: SafetyInput): SafetyItem[] {
  const chosen = input.accounts.filter((a) => input.draft.accountIds.includes(a.id));
  const platforms = Array.from(new Set(chosen.map((a) => a.platform)));
  const pacing: SafetyItem[] = pacingBlocks(rules.pacing, chosen, input.log, input.draft.accountIds, input.now).map((b) => {
    const a = chosen.find((x) => x.id === b.accountId)!;
    return { level: "block", kind: "pacing", platform: a.platform, accountId: a.id, text: pacingText(b, accountWho(a)) };
  });
  return [...pacing, ...wordItems(rules, input, platforms), ...copyItems(rules, input)];
}

export const SAFETY_ERROR = "SAFETY:";

export interface MpReviewInput {
  title: string;
  description: string;
  declaration?: PublishDraft["declaration"];
  original?: boolean;
  source?: ContentSource;
}

export function reviewMp(rules: SafetyRules, input: MpReviewInput): SafetyItem[] {
  const words: SafetyItem[] = checkWords(rules, [{ platform: "weixin", title: input.title, description: input.description, topics: [] }]).map((h) => ({
    level: "warn",
    kind: "word",
    text: "公众号" + FIELD_LABELS[h.field] + "含「" + h.word + "」（" + h.category + "）" + (h.hint ? "：" + h.hint : "") + (h.level === "block" ? "，发表时可能被微信拦截或限流，建议改掉" : ""),
  }));
  const copy = copyItems(rules, { draft: { type: "image_text", title: input.title, description: input.description, topics: [], declaration: input.declaration, original: input.original, accountIds: [] }, accounts: [], log: [], source: input.source, now: 0, mp: true });
  return [...words, ...copy.map((i) => (i.level === "block" ? { ...i, level: "warn" as const, text: i.text.replace(/。?请改写，或.*$/, "，建议改写；转载请打开「内容为转载」并填原文链接") } : i))];
}

export const mpDeclaration = (repost: boolean | undefined): PublishDraft["declaration"] => (repost ? "repost" : "none");
