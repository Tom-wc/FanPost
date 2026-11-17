import type { Declaration } from "./declarations.ts";
import type { ContentSource } from "./copy-check.ts";
import type { PublishLogEntry } from "./pacing.ts";
import type { MpDraft } from "./mp-drafts.ts";
export type Platform =
  | "douyin"
  | "kuaishou"
  | "xiaohongshu"
  | "toutiao"
  | "weixin"
  | "bilibili"
  | "qqmedia"
  | "zhihu"
  | "baijiahao"
  | "weibo";
export type PublishMode = "auto" | "assisted";
export type LoginStatus = "logged_in" | "logged_out";
export interface Account {
  id: string;
  platform: Platform;
  name: string;
  remark?: string;
  createdAt: string;
  lastOpenedAt?: string;
  loginStatus: LoginStatus;
}
export type ContentType = "video" | "image_text";
export type AccountSelections = Partial<Record<ContentType, string[]>>;
export type TaskStatus =
  | "pending"
  | "opening"
  | "uploading"
  | "publishing"
  | "manual_required"
  | "success"
  | "failed"
  | "dismissed";
export interface PublishDraft {
  id: string;
  type: ContentType;
  title: string;
  description: string;
  topics: string[];
  mediaPaths: string[];
  coverPath?: string;
  accountIds: string[];
  overrides?: ContentOverrides;
  autoSubmit?: boolean;
  scheduledAt?: string;
  scheduleQueuedAt?: string;
  question?: string;
  declaration?: Declaration;
  original?: boolean;
  source?: ContentSource;
  createdAt: string;
}
export interface PlatformContent {
  title?: string;
  description?: string;
  topics?: string[];
  coverPath?: string;
  question?: string;
  zone?: string;
}
export type ContentOverrides = Partial<Record<Platform, PlatformContent>>;
export interface DraftOverride extends PlatformContent {
  enabled: boolean;
}
export interface SavedDraft {
  id: string;
  type: ContentType;
  title: string;
  description: string;
  topics: string[];
  mediaPaths: string[];
  coverPath?: string;
  accountIds: string[];
  overrides: Partial<Record<Platform, DraftOverride>>;
  declaration?: Declaration;
  original?: boolean;
  source?: ContentSource;
  scheduledAt?: string;
  createdAt: string;
  updatedAt: string;
}
export interface PublishTask {
  id: string;
  draftId: string;
  accountId: string;
  platform: Platform;
  title: string;
  status: TaskStatus;
  message: string;
  snapshotPath?: string;
  publishedUrl?: string;
  openedAt?: string;
  createdAt: string;
  updatedAt: string;
  failure?: TaskFailure;
}
export interface TaskFailure {
  bucket: FailureBucket;
  reason: string;
  detail: string;
  at: string;
  retried: number;
  gaveUp?: boolean;
}
export type FailureBucket = "login" | "captcha" | "not_found" | "timeout" | "unconfirmed" | "quota" | "network" | "input" | "other";
export interface AppData {
  accounts: Account[];
  drafts: PublishDraft[];
  savedDrafts: SavedDraft[];
  tasks: PublishTask[];
  accountSelections: AccountSelections;
  notifications: AppNotification[];
  settings: AppSettings;
  publishLog: PublishLogEntry[];
  mpDrafts: MpDraft[];
}
export type HistoryRetention = "forever" | "30d" | "7d" | "none";
export type SystemNotifyMode = "all" | "action" | "off";
export interface AppSettings {
  imageConcurrency: number;
  videoConcurrency: number;
  samePlatformGapMin: number;
  historyRetention: HistoryRetention;
  systemNotify: SystemNotifyMode;
}
export type NotificationLevel = "info" | "success" | "warning" | "error";
export type NotificationKind =
  | "account_offline"
  | "publish_success"
  | "publish_failed"
  | "manual_required"
  | "batch_done"
  | "check_result"
  | "mp_health";
export interface AppNotification {
  id: string;
  level: NotificationLevel;
  kind: NotificationKind;
  title: string;
  message: string;
  accountId?: string;
  taskId?: string;
  createdAt: string;
  read: boolean;
}
export interface AccountInput {
  platform: Platform;
}
export interface AccountPatch {
  remark?: string;
}
export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
