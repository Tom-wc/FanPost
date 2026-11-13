import type { MpDraftInput } from "../../shared/mp-drafts";
import type { MpStyleTokens } from "../../shared/mp-style";
import type { IpInfo } from "../../main/public-ip";
import type { AlbumArticle } from "../../main/grab/album";
import type { SafetyRules } from "../../shared/safety";
import type {
  AccountInput,
  AccountPatch,
  AppSettings,
  AppData,
  BrowserBounds,
  ContentType,
  Platform,
  PublishDraft,
} from "../../shared/types";
import type { DraftInput } from "../../shared/drafts";
import type { LicenseView } from "../../shared/license";
import type { AppInfoView, AppLinkKey } from "../../shared/app-info";
import type { BatchState } from "../../main/publish-control";
import type { AiConfigView, AiRunInput } from "../../shared/ai";
import type { LeadsSettings, LeadsView, LeadsScanSummary } from "../../shared/leads";

declare global {
  interface Window {
    fanpost: {
      getData(): Promise<AppData>;
      getRecovery(): Promise<{
        recovered: boolean;
        source: "primary" | "backup" | "temporary" | "empty";
        warning?: string;
      }>;
      addAccount(x: AccountInput): Promise<AppData>;
      removeAccount(id: string): Promise<AppData>;
      updateAccount(id: string, patch: AccountPatch): Promise<AppData>;
      updateSettings(patch: Partial<AppSettings>): Promise<AppData>;
      clearHistory(): Promise<{ removed: number; data: AppData }>;
      cacheSize(): Promise<number>;
      clearCache(): Promise<{ before: number; after: number }>;
      getLicense(): Promise<LicenseView>;
      getSafetyRules(): Promise<{ rules: SafetyRules | null; ok: boolean; version: string; issuedAt: string }>;
      grabUrl(url: string): Promise<{ id: string; data: AppData; skippedImages: number; imageCount: number; notes: string[] }>;
      extractMpStyle(input: { url?: string; html?: string }): Promise<{ tokens: MpStyleTokens; title: string; url: string }>;
      extractMpTemplate(input: { url?: string; html?: string; site?: string; id?: string }): Promise<{ template: import("../../shared/mp-template").MpTemplate; title: string; url: string }>;
      openMpSite(site: string): Promise<void>;
      grabAlbum(url: string, filter: { keyword?: string; since?: string }): Promise<{ name: string; articles: AlbumArticle[] }>;
      grabBatch(list: AlbumArticle[]): Promise<{ done: number; failed: Array<{ title: string; reason: string }>; data: AppData }>;
      importDoc(): Promise<{ id: string; data: AppData; note?: string; notes: string[]; imageCount: number } | undefined>;
      importNotes(kind: "sheet" | "folder"): Promise<{ data: AppData; count: number; problems: string[] } | undefined>;
      saveNoteTemplate(): Promise<string | undefined>;
      onGrabProgress(callback: (p: { done: number; total: number; title?: string }) => void): () => void;
      getMp(): Promise<{ appId: string; health: import("../../shared/mp-health").MpHealthView | null }>;
      checkMp(): Promise<import("../../shared/mp-health").MpHealthView>;
      onMpHealth(callback: (h: import("../../shared/mp-health").MpHealthView) => void): () => void;
      saveMp(appId: string, secret: string): Promise<{ appId: string; health?: import("../../shared/mp-health").MpHealthView }>;
      clearMp(): Promise<void>;
      mpDraft(id: string | undefined, a: MpDraftInput): Promise<{ mediaId: string; id: string; data: AppData }>;
      mpStore(id: string | undefined, a: MpDraftInput): Promise<{ id: string; data: AppData }>;
      mpRemove(id: string): Promise<AppData>;
      mpImport(kind: "url" | "doc", arg?: string): Promise<{ id: string; data: AppData; imageCount: number; bodyImages: number; previewImages: number; skippedImages: number; sourceKind?: string; note?: string } | undefined>;
      mpCopy(a: MpDraftInput): Promise<{ images: number; skipped: number }>;
      getIp(force?: boolean): Promise<IpInfo>;
      onMpProgress(callback: (text: string) => void): () => void;
      activateLicense(key: string): Promise<LicenseView>;
      activateAddon(key: string): Promise<LicenseView>;
      onLicenseChanged(callback: (v: LicenseView) => void): () => void;
      refreshLicense(): Promise<LicenseView>;
      unbindLicense(): Promise<LicenseView>;
      getAppInfo(force?: boolean): Promise<AppInfoView>;
      getTutorial(): Promise<string>;
      openAppLink(key: AppLinkKey): Promise<void>;
      openUrl(url: string): Promise<void>;
      removeHistory(draftIds: string[]): Promise<{ removed: number; data: AppData }>;
      setAccountSelection(
        type: ContentType,
        accountIds: string[],
      ): Promise<AppData>;
      showBrowser(id: string, target?: "home" | "publish" | "reveal"): Promise<void>;
      hideBrowser(): Promise<void>;
      closeBrowser(id: string): Promise<void>;
      setBrowserBounds(b: BrowserBounds): Promise<void>;
      browserNavigate(
        a: "back" | "forward" | "reload" | "home",
        id: string,
      ): Promise<void>;
      pickFiles(k: "video" | "images" | "cover"): Promise<string[]>;
      extractCover(
        videoPath: string,
      ): Promise<{ path: string; dataUrl: string } | undefined>;
      saveDraft(id: string | undefined, d: DraftInput): Promise<{ id: string; data: AppData }>;
      removeDraft(id: string): Promise<AppData>;
      setDirty(dirty: boolean): Promise<void>;
      confirmClose(): Promise<void>;
      onCloseRequest(callback: () => void): () => void;
      createPublish(
        d: Omit<PublishDraft, "id" | "createdAt">,
      ): Promise<AppData>;
      autoPublish(draftId: string): Promise<AppData>;
      setPublishSchedule(draftId: string, at: string | null): Promise<AppData>;
      getUpcomingSchedules(): Promise<{ upcoming: Array<{ id: string; title: string; type: "video" | "image_text"; scheduledAt: string }> }>;
      getMissedSchedules(): Promise<Array<{ id: string; title: string; type: "video" | "image_text"; scheduledAt: string; pending: number }>>;
      runScheduledNow(draftId: string): Promise<AppData>;
      retryFailedTasks(draftId: string): Promise<{ retried: number }>;
      getPublishState(): Promise<BatchState>;
      pausePublish(): Promise<BatchState>;
      resumePublish(): Promise<BatchState>;
      stopPublish(): Promise<BatchState>;
      onPublishState(callback: (state: BatchState) => void): () => void;
      openTask(id: string): Promise<AppData>;
      completeTask(id: string): Promise<AppData>;
      checkTask(id: string): Promise<{ ok: boolean; reason?: string; data: AppData }>;
      previewTask(id: string): Promise<{ live: string; snapshot: string }>;
      openPublished(id: string): Promise<void>;
      readNotifications(ids: string[] | "all"): Promise<AppData>;
      clearNotifications(): Promise<AppData>;
      patrolAccounts(): Promise<{ checked: number; offline: number; skipped: boolean; data: AppData }>;
      onPatrolProgress(callback: (p: { done: number; total: number; accountId?: string; state?: "checking" | "online" | "offline" | "unknown" }) => void): () => void;
      readThumb(filePath: string): Promise<string>;
      pathForFile(file: File): string;
      onNotificationOpen(callback: () => void): () => void;
      onNotification(
        callback: (n: { level: string; title: string; message: string }) => void,
      ): () => void;
      failTask(id: string, reason: string): Promise<AppData>;
      dismissTasks(ids: string[]): Promise<AppData>;
      dismissAllTasks(): Promise<AppData>;
      onDataChanged(callback: () => void): () => void;
      getAiConfig(): Promise<AiConfigView & { ready: boolean; templates: boolean }>;
      saveAiConfig(config: unknown): Promise<AiConfigView & { ready: boolean }>;
      testAi(id: string): Promise<{ ok: boolean; ms?: number; sample?: string; model?: string; error?: string }>;
      /** 未保存的草稿直接测连通；key 留空则用已保存的 */
      probeAi(draft: { id?: string; name?: string; baseUrl: string; model: string; apiKey?: string }): Promise<{ ok: boolean; ms: number; sample?: string; model?: string; baseUrl?: string; error?: string }>;
      /** 拉服务商的模型列表，省得手抄模型名手抄错 */
      listAiModels(input: { id?: string; baseUrl: string; apiKey?: string }): Promise<{ ok: boolean; models: string[]; baseUrl?: string; error?: string }>;
      runAi(input: AiRunInput): Promise<{ ok: boolean; error?: string; text?: string }>;
      cancelAi(requestId: string): Promise<boolean>;
      onAiDelta(callback: (p: { requestId: string; delta: string }) => void): () => void;
      onAiDone(callback: (p: { requestId: string; ok: boolean; text: string; error?: string; model?: string }) => void): () => void;
      getLeads(): Promise<LeadsView>;
      saveLeadsSettings(settings: LeadsSettings): Promise<{ settings: LeadsSettings }>;
      scanLeads(input?: Platform[] | { platforms?: Platform[]; accountIds?: string[] }): Promise<{ ok: boolean; error?: string; summary?: LeadsScanSummary }>;
      probeLeads(input: Platform | { platform: Platform; url?: string; script?: string; waitMs?: number }): Promise<{ ok: boolean; error?: string; account?: string; probe?: unknown }>;
      replyLead(input: { id: string; text?: string; send?: boolean }): Promise<{ ok: boolean; sent?: boolean; hint?: string; error?: string; sendButton?: string }>;
      replyAllLeads(input: { ids?: string[]; platforms?: Platform[] }): Promise<{
        ok: boolean;
        error?: string;
        total?: number;
        sent?: number;
        results?: Array<{ platform: Platform; account?: string; author: string; ok: boolean; sent: boolean; error?: string }>;
      }>;
      ignoreLead(id: string): Promise<{ ok: boolean; ignored?: number }>;
      /** 批量忽略（超期评论一次清掉） */
      ignoreLeads(ids: string[]): Promise<{ ok: boolean; ignored: number }>;
      clearLeads(status?: string): Promise<{ removed: number }>;
      onLeadsChanged(callback: () => void): () => void;
      onLeadsProgress(callback: (p: { done: number; total: number; platform?: string; author?: string; finished?: boolean }) => void): () => void;
    };
  }
}
export {};
