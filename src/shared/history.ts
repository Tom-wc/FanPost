import type { AppData, HistoryRetention, TaskStatus } from "./types.ts";

export const HISTORY_OPTIONS: Array<{ value: HistoryRetention; label: string; hint: string }> = [
  { value: "forever", label: "永久保留", hint: "所有发布记录一直保存在本机，直到你手动清空" },
  { value: "30d", label: "保留 30 天", hint: "最后一次更新超过 30 天的记录自动清除" },
  { value: "7d", label: "保留 7 天", hint: "最后一次更新超过 7 天的记录自动清除" },
  { value: "none", label: "不保留", hint: "账号全部发布成功或标记失败后立即清除，只留还在等你点发布的" },
];

const RETENTION_DAYS: Partial<Record<HistoryRetention, number>> = { "30d": 30, "7d": 7 };
const DAY_MS = 86_400_000;
const FINAL: TaskStatus[] = ["success", "failed", "dismissed"];

export const isHistoryRetention = (value: unknown): value is HistoryRetention =>
  HISTORY_OPTIONS.some((o) => o.value === value);

type HistoryData = Pick<AppData, "drafts" | "tasks">;

function lastActivity(data: HistoryData, draftId: string, createdAt: string) {
  const times = [createdAt, ...data.tasks.filter((t) => t.draftId === draftId).map((t) => t.updatedAt)].map((x) => Date.parse(x) || 0);
  return Math.max(...times);
}

export function expiredDraftIds(data: HistoryData, retention: HistoryRetention, now: number, keepIds: string[] = []) {
  if (retention === "forever") return [];
  const days = RETENTION_DAYS[retention];
  return data.drafts
    .filter((d) => !keepIds.includes(d.id))
    .filter((d) => {
      if (days !== undefined) return now - lastActivity(data, d.id, d.createdAt) > days * DAY_MS;
      return data.tasks.filter((t) => t.draftId === d.id).every((t) => FINAL.includes(t.status));
    })
    .map((d) => d.id);
}

export function withoutDrafts<T extends Pick<AppData, "drafts" | "tasks" | "notifications">>(data: T, draftIds: string[]): T {
  if (!draftIds.length) return data;
  const drop = new Set(draftIds);
  const taskIds = new Set(data.tasks.filter((t) => drop.has(t.draftId)).map((t) => t.id));
  return {
    ...data,
    drafts: data.drafts.filter((d) => !drop.has(d.id)),
    tasks: data.tasks.filter((t) => !drop.has(t.draftId)),
    notifications: data.notifications.filter((n) => !n.taskId || !(drop.has(n.taskId) || taskIds.has(n.taskId))),
  };
}

const EVIDENCE = /现场截图：([^；。\s]+\.png)/g;

export function referencedFiles(data: Pick<AppData, "drafts" | "tasks"> & Partial<Pick<AppData, "savedDrafts">>) {
  const files = new Set<string>();
  for (const d of data.savedDrafts || []) if (d.coverPath) files.add(d.coverPath);
  for (const d of data.drafts) {
    if (d.coverPath) files.add(d.coverPath);
    for (const o of Object.values(d.overrides || {})) if (o?.coverPath) files.add(o.coverPath);
  }
  for (const t of data.tasks) {
    for (const m of t.message.matchAll(EVIDENCE)) files.add(m[1]);
    if (t.snapshotPath) {
      files.add(t.snapshotPath);
      for (const tail of ["", "-p", "-l"]) files.add(t.snapshotPath.replace(/snap-([^\\/]+)\.jpg$/, "cover-$1" + tail + ".jpg"));
    }
  }
  return files;
}
