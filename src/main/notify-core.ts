import type {
  AppData,
  AppNotification,
  LoginStatus,
  NotificationKind,
  NotificationLevel,
  SystemNotifyMode,
  TaskStatus,
} from "../shared/types";

export const MAX_KEPT_NOTIFICATIONS = 200;
export const LOGIN_PATROL_INTERVAL_MS = 30 * 60 * 1000;
export const LOGIN_PATROL_FIRST_DELAY_MS = 90 * 1000;
export const LOGIN_PATROL_ACCOUNT_GAP_MS = 8000;
export const MANUAL_PATROL_LANES = 3;
export const MANUAL_PATROL_SAME_PLATFORM_GAP_MS = 3000;

export interface NotificationInput {
  level: NotificationLevel;
  kind: NotificationKind;
  title: string;
  message: string;
  accountId?: string;
  taskId?: string;
}

export function pushNotification(
  data: AppData,
  input: NotificationInput,
  id: string,
  now: string,
): AppNotification {
  const created: AppNotification = { ...input, id, createdAt: now, read: false };
  const dedupKey = (n: Pick<AppNotification, "kind" | "accountId" | "taskId">) =>
    n.kind + "|" + (n.accountId || "") + "|" + (n.taskId || "");
  const key = dedupKey(created);
  data.notifications = [
    created,
    ...data.notifications.filter((n) => n.read || dedupKey(n) !== key),
  ].slice(0, MAX_KEPT_NOTIFICATIONS);
  return created;
}

export function taskNotification(
  status: TaskStatus,
  platformName: string,
  accountName: string,
  title: string,
  message: string,
): Omit<NotificationInput, "accountId" | "taskId"> | undefined {
  const who = platformName + " · " + accountName;
  if (status === "success")
    return { level: "success", kind: "publish_success", title: who + " 发布成功", message: title };
  if (status === "failed")
    return { level: "error", kind: "publish_failed", title: who + " 发布失败", message: title + "：" + message };
  if (status === "manual_required" && /^已自动点击发布/.test(message))
    return { level: "info", kind: "manual_required", title: who + " 已自动点发布，等后台确认", message: title + "：" + message };
  if (status === "manual_required")
    return { level: "warning", kind: "manual_required", title: who + (/^自动发布未/.test(message) ? " 自动发布没成功，需要你处理" : " 待你处理"), message: title + "：" + message };
  return undefined;
}

const NEEDS_YOU = /登录|验证|失败|未完成|未设置成功|未生效|未处理好|未通过|未清掉|手动/;

export function wantsSystemToast(mode: SystemNotifyMode, input: Pick<NotificationInput, "level" | "kind" | "message">, explicit?: boolean) {
  if (mode === "off" || explicit === false) return false;
  if (mode === "all") return explicit ?? input.level !== "info";
  if (input.kind === "publish_failed" || input.kind === "account_offline" || input.kind === "batch_done" || input.kind === "mp_health") return input.level !== "success";
  if (input.kind === "manual_required") return NEEDS_YOU.test(input.message);
  return false;
}

export function loginTransition(
  previous: LoginStatus | undefined,
  next: LoginStatus,
): "offline" | "online" | undefined {
  if (next === "logged_out" && previous !== "logged_out") return "offline";
  if (next === "logged_in" && previous === "logged_out") return "online";
  return undefined;
}
