import type { Platform, PublishTask } from "./types";

export type TaskBucket = "ok" | "failed" | "confirming" | "needs_you" | "running" | "dismissed";

export const AUTO_STUCK = "自动发布未完成";
const CONFIRMING = /^已自动点击发布/;

export function taskBucket(t: Pick<PublishTask, "status" | "message">): TaskBucket {
  if (t.status === "success") return "ok";
  if (t.status === "failed") return "failed";
  if (t.status === "dismissed") return "dismissed";
  if (t.status === "manual_required") return CONFIRMING.test(t.message) ? "confirming" : "needs_you";
  return "running";
}

export function countBuckets(tasks: Pick<PublishTask, "status" | "message">[]) {
  const n: Record<TaskBucket, number> = { ok: 0, failed: 0, confirming: 0, needs_you: 0, running: 0, dismissed: 0 };
  for (const t of tasks) n[taskBucket(t)]++;
  return n;
}

function reasonOf(message: string) {
  if (/安全验证/.test(message)) return "要你完成安全验证";
  if (/未找到可点击/.test(message)) return "没找到发布按钮";
  if (message.startsWith("自动发布未确认")) return "点了发布但后台没查到";
  if (message.startsWith(AUTO_STUCK)) return "自动点发布没成功";
  if (/登录|验证/.test(message)) return "要登录或验证";
  return "已填好，等你点发布";
}

export function groupByReason(tasks: Pick<PublishTask, "platform" | "message">[], name: (p: Platform) => string) {
  const map = new Map<string, Map<string, number>>();
  for (const t of tasks) {
    const reason = reasonOf(t.message);
    const per = map.get(reason) || new Map<string, number>();
    per.set(name(t.platform), (per.get(name(t.platform)) || 0) + 1);
    map.set(reason, per);
  }
  return Array.from(map.entries()).map(
    ([reason, per]) => Array.from(per.entries()).map(([p, c]) => (c > 1 ? p + "×" + c : p)).join("、") + " " + reason,
  );
}

export function batchSummary(tasks: Pick<PublishTask, "status" | "message" | "platform">[], auto: boolean, name: (p: Platform) => string) {
  const n = countBuckets(tasks);
  const needs = groupByReason(tasks.filter((t) => taskBucket(t) === "needs_you"), name);
  const parts = [
    auto ? "已发布 " + n.ok : "",
    n.confirming ? "已点发布、等后台确认 " + n.confirming : "",
    n.needs_you ? (auto ? "需要你处理 " : "待你检查并点发布 ") + n.needs_you + (auto && needs.length ? "（" + needs.join("；") + "）" : "") : "",
    n.failed ? "失败 " + n.failed : "",
  ].filter(Boolean);
  const head = auto ? "已发布 " + n.ok + "/" + tasks.length : "填写完成 " + tasks.length;
  return { head, message: "共 " + tasks.length + " 个账号：" + parts.join("，") + "。", needsYou: n.needs_you, failed: n.failed };
}
