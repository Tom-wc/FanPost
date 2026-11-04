import type { Account, Platform } from "./types.ts";
import type { PacingRules } from "./safety.ts";

export interface PublishLogEntry {
  accountId: string;
  platform: Platform;
  at: string;
}

const DAY_MS = 86_400_000;
export const LOG_KEEP_DAYS = 31;

export function startOfDay(now: number) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function isNewAccount(rules: PacingRules, account: Pick<Account, "createdAt">, now: number) {
  const created = Date.parse(account.createdAt);
  return Number.isFinite(created) && now - created < rules.newAccountDays * DAY_MS;
}

export function dailyLimit(rules: PacingRules, account: Pick<Account, "platform" | "createdAt">, now: number) {
  const base = rules.daily[account.platform] ?? rules.dailyDefault;
  return isNewAccount(rules, account, now) ? Math.min(base, rules.newAccountDaily) : base;
}

export function usedToday(log: PublishLogEntry[], accountId: string, now: number) {
  const from = startOfDay(now);
  return log.filter((e) => e.accountId === accountId && Date.parse(e.at) >= from).length;
}

export interface PacingBlock {
  accountId: string;
  used: number;
  limit: number;
  isNew: boolean;
}

export function pacingBlocks(rules: PacingRules, accounts: Pick<Account, "id" | "platform" | "createdAt">[], log: PublishLogEntry[], accountIds: string[], now: number): PacingBlock[] {
  return accounts
    .filter((a) => accountIds.includes(a.id))
    .map((a) => ({ accountId: a.id, used: usedToday(log, a.id, now), limit: dailyLimit(rules, a, now), isNew: isNewAccount(rules, a, now) }))
    .filter((b) => b.used >= b.limit);
}

export function pruneLog(log: PublishLogEntry[], now: number) {
  const from = now - LOG_KEEP_DAYS * DAY_MS;
  return log.filter((e) => Date.parse(e.at) >= from);
}

export function parsePublishLog(value: unknown): PublishLogEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is PublishLogEntry =>
      Boolean(e) && typeof e.accountId === "string" && typeof e.platform === "string" && typeof e.at === "string" && Number.isFinite(Date.parse(e.at)),
  ).map((e) => ({ accountId: e.accountId, platform: e.platform, at: e.at }));
}

export const effectiveGapMin = (rules: PacingRules | undefined, settingMin: number) => Math.max(settingMin, rules?.minGapMin ?? 0);

export function pacingText(b: PacingBlock, who: string) {
  return who + " 今天已填写 " + b.used + " 次，" + (b.isNew ? "新账号" : "") + "每天最多 " + b.limit + " 次，明天再发";
}
