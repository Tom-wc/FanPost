import type { Account, AppSettings, Platform, SystemNotifyMode } from "./types";
import { platformMap } from "./platforms.ts";
import { isHistoryRetention } from "./history.ts";

export const REMARK_MAX = 20;

export const DEFAULT_SETTINGS: AppSettings = {
  imageConcurrency: 4,
  videoConcurrency: 3,
  samePlatformGapMin: 10,
  historyRetention: "forever",
  systemNotify: "action",
};

export const SYSTEM_NOTIFY_OPTIONS: Array<{ value: SystemNotifyMode; label: string; hint: string }> = [
  { value: "action", label: "只提醒需要处理的", hint: "失败、掉线、需要你验证或手动补设置时弹出，每批结束弹一条汇总" },
  { value: "all", label: "全部", hint: "每个账号填写完成、失败、成功都弹出，批量发布时会比较多" },
  { value: "off", label: "关闭", hint: "不弹 Windows 通知，只在软件左下角通知中心里显示" },
];

const isSystemNotifyMode = (value: unknown): value is SystemNotifyMode => SYSTEM_NOTIFY_OPTIONS.some((o) => o.value === value);

export const SETTING_LIMITS = {
  concurrency: { min: 1, max: 9 },
  samePlatformGapMin: { min: 0, max: 720 },
};

const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function normalizeSettings(value: unknown): AppSettings {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const { concurrency, samePlatformGapMin } = SETTING_LIMITS;
  return {
    imageConcurrency: clampInt(raw.imageConcurrency, concurrency.min, concurrency.max, DEFAULT_SETTINGS.imageConcurrency),
    videoConcurrency: clampInt(raw.videoConcurrency, concurrency.min, concurrency.max, DEFAULT_SETTINGS.videoConcurrency),
    samePlatformGapMin: clampInt(raw.samePlatformGapMin, samePlatformGapMin.min, samePlatformGapMin.max, DEFAULT_SETTINGS.samePlatformGapMin),
    historyRetention: isHistoryRetention(raw.historyRetention) ? raw.historyRetention : DEFAULT_SETTINGS.historyRetention,
    systemNotify: isSystemNotifyMode(raw.systemNotify) ? raw.systemNotify : DEFAULT_SETTINGS.systemNotify,
  };
}

export const normalizeRemark = (value: unknown) =>
  typeof value === "string" ? Array.from(value.trim()).slice(0, REMARK_MAX).join("") : "";

export const accountLabel = (account: Pick<Account, "name" | "remark">) => account.remark?.trim() || account.name;

export const accountWho = (account: Pick<Account, "platform" | "name" | "remark">) =>
  platformMap[account.platform].name + " · " + accountLabel(account);

export function groupByPlatform<T extends { platform: Platform }>(items: T[]): T[][] {
  const buckets = new Map<Platform, T[]>();
  for (const item of items) buckets.set(item.platform, [...(buckets.get(item.platform) || []), item]);
  return Array.from(buckets.values());
}

export function interleaveByPlatform<T extends { platform: Platform }>(items: T[]): T[] {
  const queues = groupByPlatform(items);
  const result: T[] = [];
  for (let round = 0; result.length < items.length; round++)
    for (const q of queues) if (q[round]) result.push(q[round]);
  return result;
}

export function countByPlatform(accounts: Pick<Account, "platform">[]) {
  const counts: Partial<Record<Platform, number>> = {};
  for (const a of accounts) counts[a.platform] = (counts[a.platform] || 0) + 1;
  return counts;
}
