import { app } from "electron";
import { osCodec } from "./secure-file";
import { PersistentJsonStore } from "./persistent-store";
import type {
  Account,
  AccountSelections,
  AppData,
  AppNotification,
  ContentOverrides,
  ContentType,
  PlatformContent,
  PublishDraft,
  PublishTask,
} from "../shared/types";
import { platforms as platformDefs } from "../shared/platforms";
import { DEFAULT_SETTINGS, normalizeRemark, normalizeSettings } from "../shared/accounts";
import { parseSavedDrafts } from "../shared/drafts";
import { parseSource } from "../shared/copy-check";
import { parsePublishLog } from "../shared/pacing";
import { parseMpDrafts } from "../shared/mp-drafts";

export const MAX_NOTIFICATIONS = 200;
const empty: AppData = {
  accounts: [],
  drafts: [],
  savedDrafts: [],
  tasks: [],
  accountSelections: {},
  notifications: [],
  settings: DEFAULT_SETTINGS,
  publishLog: [],
  mpDrafts: [],
};
const notificationLevels = new Set(["info", "success", "warning", "error"]);
const notificationKinds = new Set([
  "account_offline",
  "publish_success",
  "publish_failed",
  "manual_required",
  "batch_done",
  "check_result",
  "mp_health",
]);
const platforms = new Set<string>(platformDefs.map((p) => p.id));
const statuses = new Set(["logged_in", "logged_out"]);
const taskStatuses = new Set([
  "pending",
  "opening",
  "uploading",
  "publishing",
  "manual_required",
  "success",
  "failed",
  "dismissed",
]);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const isString = (value: unknown): value is string => typeof value === "string";
const stringArray = (value: unknown, name: string) => {
  if (!Array.isArray(value) || value.some((item) => !isString(item)))
    throw new Error(`${name}数据结构无效`);
  return value as string[];
};
const records = (value: unknown, name: string) => {
  if (!Array.isArray(value) || value.some((item) => !isRecord(item)))
    throw new Error(`${name}数据结构无效`);
  return value as Record<string, unknown>[];
};

function parseAppData(value: unknown): AppData {
  if (
    !isRecord(value) ||
    !Array.isArray(value.accounts) ||
    !Array.isArray(value.drafts) ||
    !Array.isArray(value.tasks)
  ) {
    throw new Error("应用数据结构无效");
  }
  const accounts = records(value.accounts, "账号").map((account) => {
    if (
      !isString(account.id) ||
      !platforms.has(String(account.platform)) ||
      !isString(account.name)
    )
      throw new Error("账号记录无效");
    const remark = normalizeRemark(account.remark);
    return {
      ...account,
      id: account.id as string,
      platform: account.platform as Account["platform"],
      name: account.name as string,
      remark: remark || undefined,
      createdAt: isString(account.createdAt)
        ? account.createdAt
        : new Date(0).toISOString(),
      loginStatus: statuses.has(String(account.loginStatus))
        ? (account.loginStatus as Account["loginStatus"])
        : "logged_out",
    };
  }) as Account[];
  const drafts = records(value.drafts, "草稿").map((draft) => {
    if (
      !isString(draft.id) ||
      (draft.type !== "video" && draft.type !== "image_text") ||
      !isString(draft.title) ||
      !Array.isArray(draft.mediaPaths) ||
      !Array.isArray(draft.accountIds)
    )
      throw new Error("草稿记录无效");
    const mediaPaths = stringArray(draft.mediaPaths, "视频路径");
    const accountIds = stringArray(draft.accountIds, "账号引用");
    return {
      ...draft,
      id: draft.id as string,
      type: draft.type as PublishDraft["type"],
      title: draft.title as string,
      description: isString(draft.description) ? draft.description : "",
      topics:
        draft.topics === undefined ? [] : stringArray(draft.topics, "话题标签"),
      mediaPaths,
      accountIds,
      overrides: parseOverrides(draft.overrides),
      ...(draft.autoSubmit === true ? { autoSubmit: true } : {}),
      ...(draft.original === true ? { original: true } : {}),
      source: parseSource(draft.source),
      createdAt: isString(draft.createdAt)
        ? draft.createdAt
        : new Date(0).toISOString(),
    };
  }) as PublishDraft[];
  const tasks = records(value.tasks, "任务").map((task) => {
    if (
      !isString(task.id) ||
      !isString(task.draftId) ||
      !isString(task.accountId) ||
      !platforms.has(String(task.platform)) ||
      !isString(task.title)
    )
      throw new Error("任务记录无效");
    return {
      ...task,
      id: task.id as string,
      draftId: task.draftId as string,
      accountId: task.accountId as string,
      platform: task.platform as Account["platform"],
      title: task.title as string,
      status: taskStatuses.has(String(task.status))
        ? (task.status as PublishTask["status"])
        : "pending",
      message: isString(task.message) ? task.message : "",
      snapshotPath: isString(task.snapshotPath) ? task.snapshotPath : undefined,
      publishedUrl: isString(task.publishedUrl) && /^https?:\/\//i.test(task.publishedUrl) ? task.publishedUrl : undefined,
      openedAt: isString(task.openedAt) ? task.openedAt : undefined,
      createdAt: isString(task.createdAt)
        ? task.createdAt
        : new Date(0).toISOString(),
      updatedAt: isString(task.updatedAt)
        ? task.updatedAt
        : new Date(0).toISOString(),
    };
  }) as PublishTask[];
  const accountSelections: AccountSelections = {};
  if (value.accountSelections !== undefined) {
    if (!isRecord(value.accountSelections)) throw new Error("账号选择记录无效");
    for (const type of ["video", "image_text"] as ContentType[]) {
      const selected = value.accountSelections[type];
      if (selected !== undefined)
        accountSelections[type] = stringArray(selected, `${type}账号选择`);
    }
  }
  const notifications = Array.isArray(value.notifications)
    ? (value.notifications as unknown[])
        .filter(isRecord)
        .filter(
          (n) =>
            isString(n.id) &&
            isString(n.title) &&
            notificationLevels.has(String(n.level)) &&
            notificationKinds.has(String(n.kind)),
        )
        .map((n) => ({
          id: n.id as string,
          level: n.level as AppNotification["level"],
          kind: n.kind as AppNotification["kind"],
          title: n.title as string,
          message: isString(n.message) ? n.message : "",
          ...(isString(n.accountId) ? { accountId: n.accountId } : {}),
          ...(isString(n.taskId) ? { taskId: n.taskId } : {}),
          createdAt: isString(n.createdAt) ? n.createdAt : new Date(0).toISOString(),
          read: n.read === true,
        }))
        .slice(0, MAX_NOTIFICATIONS)
    : [];
  return { accounts, drafts, savedDrafts: parseSavedDrafts(value.savedDrafts), tasks, accountSelections, notifications, settings: normalizeSettings(value.settings), publishLog: parsePublishLog(value.publishLog), mpDrafts: parseMpDrafts(value.mpDrafts) };
}
function parseOverrides(value: unknown): ContentOverrides | undefined {
  if (!isRecord(value)) return undefined;
  const result: ContentOverrides = {};
  for (const [platform, raw] of Object.entries(value)) {
    if (!platforms.has(platform) || !isRecord(raw)) continue;
    const content: PlatformContent = {};
    if (isString(raw.title)) content.title = raw.title;
    if (isString(raw.description)) content.description = raw.description;
    if (Array.isArray(raw.topics) && raw.topics.every(isString))
      content.topics = raw.topics as string[];
    if (isString(raw.coverPath)) content.coverPath = raw.coverPath;
    if (isString(raw.question) && raw.question.trim()) content.question = raw.question;
    if (isString(raw.zone) && raw.zone.trim()) content.zone = raw.zone;
    if (Object.keys(content).length)
      result[platform as Account["platform"]] = content;
  }
  return Object.keys(result).length ? result : undefined;
}

export class JsonStore extends PersistentJsonStore<AppData> {
  constructor() {
    super({
      directory: app.getPath("userData"),
      fileName: "fanpost-data.json",
      empty,
      parse: parseAppData,
      codec: osCodec(),
    });
  }
}
