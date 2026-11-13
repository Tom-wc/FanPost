import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AccountInput,
  AccountPatch,
  AppSettings,
  BrowserBounds,
  ContentType,
  PublishDraft,
} from "../shared/types";
contextBridge.exposeInMainWorld("fanpost", {
  getData: () => ipcRenderer.invoke("data:get"),
  getRecovery: () => ipcRenderer.invoke("data:recovery"),
  addAccount: (x: AccountInput) => ipcRenderer.invoke("account:add", x),
  removeAccount: (id: string) => ipcRenderer.invoke("account:remove", id),
  updateAccount: (id: string, patch: AccountPatch) => ipcRenderer.invoke("account:update", id, patch),
  updateSettings: (patch: Partial<AppSettings>) => ipcRenderer.invoke("settings:update", patch),
  clearHistory: () => ipcRenderer.invoke("history:clear"),
  cacheSize: () => ipcRenderer.invoke("cache:size"),
  clearCache: () => ipcRenderer.invoke("cache:clear"),
  getLicense: () => ipcRenderer.invoke("license:get"),
  getSafetyRules: () => ipcRenderer.invoke("safety:rules"),
  grabUrl: (url: string) => ipcRenderer.invoke("grab:url", url),
  extractMpStyle: (input: { url?: string; html?: string }) => ipcRenderer.invoke("mp:extract-style", input),
  extractMpTemplate: (input: { url?: string; html?: string; site?: string; id?: string }) => ipcRenderer.invoke("mp:extract-template", input),
  openMpSite: (site: string) => ipcRenderer.invoke("mp:open-site", site),
  grabAlbum: (url: string, filter: { keyword?: string; since?: string }) => ipcRenderer.invoke("grab:album", url, filter),
  grabBatch: (list: unknown[]) => ipcRenderer.invoke("grab:batch", list),
  importDoc: () => ipcRenderer.invoke("grab:doc"),
  importNotes: (kind: "sheet" | "folder") => ipcRenderer.invoke("note:import", kind),
  saveNoteTemplate: () => ipcRenderer.invoke("note:template"),
  onGrabProgress: (callback: (p: { done: number; total: number; title?: string }) => void) => {
    const listener = (_e: unknown, p: { done: number; total: number; title?: string }) => callback(p);
    ipcRenderer.on("grab:progress", listener);
    return () => ipcRenderer.removeListener("grab:progress", listener);
  },
  getMp: () => ipcRenderer.invoke("mp:get"),
  checkMp: () => ipcRenderer.invoke("mp:health"),
  onMpHealth: (callback: (h: unknown) => void) => {
    const listener = (_e: unknown, h: unknown) => callback(h);
    ipcRenderer.on("mp:health", listener);
    return () => ipcRenderer.removeListener("mp:health", listener);
  },
  saveMp: (appId: string, secret: string) => ipcRenderer.invoke("mp:save", appId, secret),
  clearMp: () => ipcRenderer.invoke("mp:clear"),
  mpDraft: (id: string | undefined, a: unknown) => ipcRenderer.invoke("mp:draft", id, a),
  mpStore: (id: string | undefined, a: unknown) => ipcRenderer.invoke("mp:store", id, a),
  mpRemove: (id: string) => ipcRenderer.invoke("mp:remove", id),
  mpImport: (kind: "url" | "doc", arg?: string) => ipcRenderer.invoke("mp:import", kind, arg),
  getIp: (force?: boolean) => ipcRenderer.invoke("net:ip", force === true),
  mpCopy: (a: unknown) => ipcRenderer.invoke("mp:copy", a),
  onMpProgress: (callback: (text: string) => void) => {
    const listener = (_e: unknown, text: string) => callback(text);
    ipcRenderer.on("mp:progress", listener);
    return () => ipcRenderer.removeListener("mp:progress", listener);
  },
  activateLicense: (key: string) => ipcRenderer.invoke("license:activate", key),
  activateAddon: (key: string) => ipcRenderer.invoke("license:addon", key),
  onLicenseChanged: (callback: (v: unknown) => void) => {
    const listener = (_e: unknown, v: unknown) => callback(v);
    ipcRenderer.on("license:changed", listener);
    return () => ipcRenderer.removeListener("license:changed", listener);
  },
  refreshLicense: () => ipcRenderer.invoke("license:refresh"),
  unbindLicense: () => ipcRenderer.invoke("license:unbind"),
  getAppInfo: (force?: boolean) => ipcRenderer.invoke("app:info", force === true),
  getTutorial: () => ipcRenderer.invoke("tutorial:get"),
  openAppLink: (key: string) => ipcRenderer.invoke("app:open-link", key),
  openUrl: (url: string) => ipcRenderer.invoke("app:open-url", url),
  removeHistory: (draftIds: string[]) => ipcRenderer.invoke("history:remove", draftIds),
  setAccountSelection: (type: ContentType, accountIds: string[]) =>
    ipcRenderer.invoke("account:selection", type, accountIds),
  showBrowser: (id: string, target?: "home" | "publish" | "reveal") =>
    ipcRenderer.invoke("browser:show", id, target),
  hideBrowser: () => ipcRenderer.invoke("browser:hide"),
  closeBrowser: (id: string) => ipcRenderer.invoke("browser:close", id),
  setBrowserBounds: (b: BrowserBounds) =>
    ipcRenderer.invoke("browser:bounds", b),
  browserNavigate: (a: "back" | "forward" | "reload" | "home", id: string) =>
    ipcRenderer.invoke("browser:navigate", a, id),
  pickFiles: (k: "video" | "images" | "cover") =>
    ipcRenderer.invoke("file:pick", k),
  extractCover: (videoPath: string) =>
    ipcRenderer.invoke("video:cover", videoPath).then((result) => {
      if (!result?.ok) throw new Error(result?.error || "封面提取失败");
      return { path: result.path, dataUrl: result.dataUrl };
    }),
  saveDraft: (id: string | undefined, d: unknown) => ipcRenderer.invoke("draft:save", id, d),
  setDirty: (dirty: boolean) => ipcRenderer.invoke("app:dirty", dirty),
  confirmClose: () => ipcRenderer.invoke("app:close-confirmed"),
  onCloseRequest: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("app:close-request", listener);
    return () => ipcRenderer.removeListener("app:close-request", listener);
  },
  removeDraft: (id: string) => ipcRenderer.invoke("draft:remove", id),
  createPublish: (d: Omit<PublishDraft, "id" | "createdAt">) =>
    ipcRenderer.invoke("publish:create", d),
  autoPublish: (draftId: string) => ipcRenderer.invoke("publish:auto", draftId),
  setPublishSchedule: (draftId: string, at: string | null) => ipcRenderer.invoke("publish:schedule", draftId, at),
  getUpcomingSchedules: () => ipcRenderer.invoke("publish:upcoming"),
  getMissedSchedules: () => ipcRenderer.invoke("publish:missed"),
  runScheduledNow: (draftId: string) => ipcRenderer.invoke("publish:run-now", draftId),
  retryFailedTasks: (draftId: string) => ipcRenderer.invoke("publish:retry-failed", draftId),
  getPublishState: () => ipcRenderer.invoke("publish:state"),
  pausePublish: () => ipcRenderer.invoke("publish:pause"),
  resumePublish: () => ipcRenderer.invoke("publish:resume"),
  stopPublish: () => ipcRenderer.invoke("publish:stop"),
  onPublishState: (callback: (state: string) => void) => {
    const listener = (_e: unknown, state: string) => callback(state);
    ipcRenderer.on("publish:state", listener);
    return () => ipcRenderer.removeListener("publish:state", listener);
  },
  openTask: (id: string) => ipcRenderer.invoke("task:open", id),
  completeTask: (id: string) => ipcRenderer.invoke("task:complete", id),
  checkTask: (id: string) => ipcRenderer.invoke("task:check", id),
  previewTask: (id: string) => ipcRenderer.invoke("task:preview", id),
  openPublished: (id: string) => ipcRenderer.invoke("task:open-published", id),
  readNotifications: (ids: string[] | "all") =>
    ipcRenderer.invoke("notification:read", ids),
  clearNotifications: () => ipcRenderer.invoke("notification:clear"),
  patrolAccounts: () => ipcRenderer.invoke("account:patrol"),
  onPatrolProgress: (callback: (p: { done: number; total: number; accountId?: string; state?: "checking" | "online" | "offline" | "unknown" }) => void) => {
    const listener = (_e: unknown, p: { done: number; total: number; accountId?: string; state?: "checking" | "online" | "offline" | "unknown" }) => callback(p);
    ipcRenderer.on("patrol:progress", listener);
    return () => ipcRenderer.removeListener("patrol:progress", listener);
  },
  readThumb: (filePath: string) => ipcRenderer.invoke("file:thumb", filePath),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  onNotificationOpen: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("notification:open", listener);
    return () => ipcRenderer.removeListener("notification:open", listener);
  },
  onNotification: (callback: (n: { level: string; title: string; message: string }) => void) => {
    const listener = (_e: unknown, n: { level: string; title: string; message: string }) => callback(n);
    ipcRenderer.on("notification:new", listener);
    return () => ipcRenderer.removeListener("notification:new", listener);
  },
  failTask: (id: string, reason: string) =>
    ipcRenderer.invoke("task:fail", id, reason),
  dismissTasks: (ids: string[]) => ipcRenderer.invoke("task:dismiss", ids),
  dismissAllTasks: () => ipcRenderer.invoke("task:dismiss-all"),
  onDataChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("data:changed", listener);
    return () => ipcRenderer.removeListener("data:changed", listener);
  },
  getAiConfig: () => ipcRenderer.invoke("ai:config"),
  saveAiConfig: (config: unknown) => ipcRenderer.invoke("ai:save", config),
  testAi: (id: string) => ipcRenderer.invoke("ai:test", id),
  probeAi: (draft: unknown) => ipcRenderer.invoke("ai:probe", draft),
  listAiModels: (input: unknown) => ipcRenderer.invoke("ai:models", input),
  runAi: (input: unknown) => ipcRenderer.invoke("ai:run", input),
  cancelAi: (requestId: string) => ipcRenderer.invoke("ai:cancel", requestId),
  onAiDelta: (callback: (p: { requestId: string; delta: string }) => void) => {
    const listener = (_e: unknown, p: { requestId: string; delta: string }) => callback(p);
    ipcRenderer.on("ai:delta", listener);
    return () => ipcRenderer.removeListener("ai:delta", listener);
  },
  onAiDone: (callback: (p: { requestId: string; ok: boolean; text: string; error?: string; model?: string }) => void) => {
    const listener = (_e: unknown, p: { requestId: string; ok: boolean; text: string; error?: string; model?: string }) => callback(p);
    ipcRenderer.on("ai:done", listener);
    return () => ipcRenderer.removeListener("ai:done", listener);
  },
  getLeads: () => ipcRenderer.invoke("leads:get"),
  saveLeadsSettings: (settings: unknown) => ipcRenderer.invoke("leads:save-settings", settings),
  scanLeads: (platforms: unknown) => ipcRenderer.invoke("leads:scan", platforms),
  probeLeads: (input: unknown) => ipcRenderer.invoke("leads:probe", input),
  replyLead: (input: unknown) => ipcRenderer.invoke("leads:reply", input),
  replyAllLeads: (platforms: unknown) => ipcRenderer.invoke("leads:reply-all", platforms),
  ignoreLead: (id: string) => ipcRenderer.invoke("leads:ignore", id),
  ignoreLeads: (ids: string[]) => ipcRenderer.invoke("leads:ignore", ids),
  clearLeads: (status: unknown) => ipcRenderer.invoke("leads:clear", status),
  onLeadsChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("leads:changed", listener);
    return () => ipcRenderer.removeListener("leads:changed", listener);
  },
  onLeadsProgress: (callback: (p: { done: number; total: number; platform?: string; author?: string; finished?: boolean }) => void) => {
    const listener = (_e: unknown, p: { done: number; total: number; platform?: string; author?: string; finished?: boolean }) => callback(p);
    ipcRenderer.on("leads:progress", listener);
    return () => ipcRenderer.removeListener("leads:progress", listener);
  }
});
