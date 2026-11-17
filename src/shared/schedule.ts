import type { ContentType, PublishDraft, PublishTask } from "./types";

export const SCHEDULE_CHECK_MS = 15000;
export const SCHEDULE_MAX_AHEAD_DAYS = 30;

export const SCHEDULE_HINT = [
  "定时任务是这台电脑在跑：到点时软件必须开着、电脑不能睡眠或关机，浏览器账号保持登录。",
  "同一时间只会跑一批（图文和视频也不会同时跑），所以排得再密也会按顺序执行，不会卡死，只是会延后。",
  "按实测：一批 10 个账号的图文大约 25–40 分钟，视频大约 40–70 分钟；同平台两个号之间默认隔 10 分钟。",
  "建议：同一时段内不要排超过「同时填写数 × 2」条（图文默认 4 → 8 条，视频默认 3 → 6 条），再多就会排到很晚；一天排 20 条以内比较稳。",
  "软件关掉期间到点的任务不会丢，下次打开会弹窗问你要不要继续。",
].join("\n");

export function isScheduled(draft: Pick<PublishDraft, "scheduledAt">): boolean {
  return Boolean(draft.scheduledAt && Date.parse(draft.scheduledAt) > 0);
}

export function scheduledAtOf(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return undefined;
  if (t < Date.now() - 365 * 86400000) return undefined;
  if (t > Date.now() + SCHEDULE_MAX_AHEAD_DAYS * 86400000) return undefined;
  return new Date(t).toISOString();
}

const OPEN: PublishTask["status"][] = ["pending", "opening", "uploading", "publishing"];

export function nextDueDraft<T extends Pick<PublishDraft, "id" | "title" | "scheduledAt">>(
  drafts: T[],
  tasks: Pick<PublishTask, "draftId" | "status">[],
  now: number,
): T | undefined {
  const open = new Set(tasks.filter((t) => OPEN.includes(t.status)).map((t) => t.draftId));
  return drafts
    .filter((d) => isScheduled(d) && open.has(d.id) && Date.parse(d.scheduledAt!) <= now)
    .sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!))[0];
}

export interface MissedSchedule {
  id: string;
  title: string;
  type: ContentType;
  scheduledAt: string;
  pending: number;
}

export function missedSchedules(drafts: PublishDraft[], tasks: Pick<PublishTask, "draftId" | "status">[], now: number): MissedSchedule[] {
  const openCount = new Map<string, number>();
  for (const t of tasks) if (OPEN.includes(t.status)) openCount.set(t.draftId, (openCount.get(t.draftId) ?? 0) + 1);
  return drafts
    .filter((d) => isScheduled(d) && Date.parse(d.scheduledAt!) <= now && (openCount.get(d.id) ?? 0) > 0)
    .sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!))
    .map((d) => ({ id: d.id, title: d.title, type: d.type, scheduledAt: d.scheduledAt!, pending: openCount.get(d.id) ?? 0 }));
}

export function upcomingSchedules(drafts: PublishDraft[], tasks: Pick<PublishTask, "draftId" | "status">[], now: number) {
  const open = new Set(tasks.filter((t) => OPEN.includes(t.status)).map((t) => t.draftId));
  return drafts
    .filter((d) => isScheduled(d) && open.has(d.id) && Date.parse(d.scheduledAt!) > now)
    .sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!));
}
