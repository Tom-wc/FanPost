import { BrowserWindow, WebContentsView, session, shell } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { Account, BrowserBounds, LoginStatus, PublishDraft } from "../shared/types";
import { platformMap } from "../shared/platforms";
import { isAssisted, resolveDraft } from "../shared/platform-rules";
import { writeBrowserLog } from "./log-bus";
import {
  chromeUserAgent,
  ignoreAborted,
  XHS_PUBLISH_PATH_IMAGE,
  XHS_PUBLISH_PATH_VIDEO,
  xhsOriginFromUrl,
  type AccountUpdate,
  type PublishProgress,
  type PublishResult,
} from "./browser/common";
import { prepareLoginPage, settleLogin } from "./browser/login";
import { verifyPublishedTitle, type VerifyResult } from "./browser/verify";
import { assistedMessage, healZhihuImages, publishArticle } from "./browser/article";
import { flows } from "./flow-runtime";
import { autoSubmit } from "./browser/submit";

export { chromeUserAgent, type PublishProgress };

const CHECK_PUBLISHED_TIMEOUT = 60000;
const CHECK_PUBLISHED_HARD_LIMIT = 150000;
const INSPECT_DEBOUNCE_MS = 1400;
const DOCK_SIZE = { width: 1280, height: 900 };
const MIN_FIT_ZOOM = 0.5;
const REFIT_DELAYS_MS = [1500, 4000];
const REFIT_INTERVAL_MS = 2000;
const CONTENT_WIDTH = "({sw:Math.max(document.documentElement.scrollWidth,document.body?document.body.scrollWidth:0),iw:document.documentElement.clientWidth,sb:Math.max(0,innerWidth-document.documentElement.clientWidth)})";
const FIT_MARGIN = 1.02;
const FLUID_ZOOM_STEP = 0.005;
const fitZoom = (width: number, content: number) => Math.max(MIN_FIT_ZOOM, Math.min(1, width / Math.max(DOCK_SIZE.width, content)));
const PREVIEW_WIDTH = 480;
const SNAPSHOT_WIDTH = 1280;
const PREVIEW_QUALITY = 78;

export class BrowserManager {
  private views = new Map<string, WebContentsView>();
  private inspectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private inspectVersions = new Map<string, number>();
  private sessionFlushes = new Map<string, Promise<void>>();
  private xhsOrigins = new Map<string, string>();
  private dock?: BrowserWindow;
  private active?: string;
  private bounds: BrowserBounds = { x: 280, y: 160, width: 900, height: 650 };
  private boundsKnown = false;
  private fitState = new WeakMap<Electron.WebContents, { needed: number; zoom: number; over: number; fluid: boolean }>();
  constructor(
    private win: BrowserWindow,
    private updateAccount: (id: string, update: AccountUpdate) => Promise<void>,
  ) {
    const refit = setInterval(() => {
      const view = this.active ? this.views.get(this.active) : undefined;
      if (view && this.isShown(view)) void this.fitActive(view);
    }, REFIT_INTERVAL_MS);
    win.on("closed", () => {
      clearInterval(refit);
      if (this.dock && !this.dock.isDestroyed()) this.dock.destroy();
      this.dock = undefined;
    });
  }

  private accountSession(accountId: string) {
    return session.fromPartition("persist:account-" + accountId);
  }

  private xhsUrl(account: Account, path: string) {
    const origin = this.xhsOrigins.get(account.id) || xhsOriginFromUrl(this.views.get(account.id)?.webContents.getURL());
    return origin.replace(/\/+$/, "") + path;
  }

  private urlFor(account: Account, target: "home" | "publish", type: PublishDraft["type"] = "video") {
    const p = platformMap[account.platform];
    if (account.platform !== "xiaohongshu") return target === "publish" ? p.publishUrl : p.homeUrl;
    if (target === "home") return this.xhsUrl(account, "/");
    return this.xhsUrl(account, type === "video" ? XHS_PUBLISH_PATH_VIDEO : XHS_PUBLISH_PATH_IMAGE);
  }

  private flushAccountSession(accountId: string, reason: string) {
    const existing = this.sessionFlushes.get(accountId);
    if (existing) return existing;
    const profile = this.accountSession(accountId);
    const flush = Promise.all([profile.cookies.flushStore(), profile.flushStorageData()])
      .then(() => writeBrowserLog(`session-flushed account=${accountId} reason=${reason}`))
      .catch((error) => writeBrowserLog(`session-flush-failed account=${accountId} reason=${reason} error=${String(error)}`))
      .finally(() => this.sessionFlushes.delete(accountId));
    this.sessionFlushes.set(accountId, flush);
    return flush;
  }

  private hiddenWindow(account: Account) {
    const w = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      width: 1280,
      height: 900,
      webPreferences: { session: this.accountSession(account.id), nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    w.webContents.setUserAgent(chromeUserAgent);
    w.webContents.setAudioMuted(true);
    return w;
  }

  private async settle(account: Account, wc: Electron.WebContents, isStale?: () => boolean) {
    const result = await settleLogin(account, wc, isStale);
    if (account.platform === "xiaohongshu" && !wc.isDestroyed()) this.xhsOrigins.set(account.id, xhsOriginFromUrl(wc.getURL()));
    return result;
  }

  private dockWindow() {
    if (this.dock && !this.dock.isDestroyed()) return this.dock;
    if (this.win.isDestroyed()) throw new Error("主窗口已关闭");
    const w = new BrowserWindow({
      show: false,
      x: -32000,
      y: -32000,
      width: DOCK_SIZE.width,
      height: DOCK_SIZE.height,
      frame: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: { backgroundThrottling: false },
    });
    w.showInactive();
    this.dock = w;
    return w;
  }

  private parkView(view: WebContentsView) {
    if (this.win.contentView.children.includes(view)) this.win.contentView.removeChildView(view);
    const dock = this.dockWindow();
    if (!dock.contentView.children.includes(view)) dock.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, ...DOCK_SIZE });
    view.webContents.setZoomFactor(1);
  }

  private placeActive(view: WebContentsView) {
    view.setBounds(this.bounds);
    void this.fitActive(view);
  }

  private isShown(view: WebContentsView) {
    return !!this.active && this.views.get(this.active) === view && this.win.contentView.children.includes(view);
  }

  private async fitActive(view: WebContentsView) {
    const wc = view.webContents;
    if (wc.isDestroyed()) return;
    if (!this.isShown(view)) {
      wc.setZoomFactor(1);
      return;
    }
    const m = (await wc.executeJavaScript(CONTENT_WIDTH).catch(() => null)) as { sw: number; iw: number; sb: number } | null;
    const zoom = wc.getZoomFactor();
    const st = this.fitState.get(wc) || { needed: DOCK_SIZE.width, zoom, over: 0, fluid: false };
    if (m && !st.fluid) {
      const over = m.sw - m.iw;
      const shrunk = zoom < st.zoom - FLUID_ZOOM_STEP;
      if (over > 1 && st.over > 1 && shrunk && over > st.over / 2) st.fluid = true;
      else if (over > 1) st.needed = Math.max(st.needed, Math.ceil((m.sw + m.sb) * FIT_MARGIN));
      st.over = over;
    }
    st.zoom = zoom;
    this.fitState.set(wc, st);
    if (!wc.isDestroyed() && this.isShown(view)) wc.setZoomFactor(fitZoom(this.bounds.width, st.needed));
  }

  private refitSoon(view: WebContentsView, fresh = false) {
    if (fresh) this.fitState.delete(view.webContents);
    void this.fitActive(view);
    for (const ms of REFIT_DELAYS_MS) setTimeout(() => void this.fitActive(view), ms);
  }

  private attachActive(view: WebContentsView) {
    if (!this.boundsKnown) return;
    const dock = this.dockWindow();
    if (dock.contentView.children.includes(view)) dock.contentView.removeChildView(view);
    if (!this.win.contentView.children.includes(view)) this.win.contentView.addChildView(view);
    this.placeActive(view);
  }

  private ensureView(account: Account) {
    const existing = this.views.get(account.id);
    if (existing) return existing;
    const view = new WebContentsView({
      webPreferences: { session: this.accountSession(account.id), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    const wc = view.webContents;
    wc.setUserAgent(chromeUserAgent);
    void writeBrowserLog(`create account=${account.id} platform=${account.platform}`);
    wc.setWindowOpenHandler(({ url }) => {
      void writeBrowserLog(`window-open account=${account.id} url=${url}`);
      if (account.platform === "weixin")
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            show: true,
            width: 900,
            height: 700,
            autoHideMenuBar: true,
            webPreferences: {
              session: this.accountSession(account.id),
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
              backgroundThrottling: false,
            },
          },
        };
      if (url.startsWith("http")) void wc.loadURL(url);
      else if (/^(mailto|tel):/i.test(url)) void shell.openExternal(url);
      else void writeBrowserLog(`ignore-external-scheme account=${account.id} url=${url}`);
      return { action: "deny" };
    });
    const blockExternalNav = (event: Electron.Event, url: string) => {
      if (/^https?:/i.test(url)) return;
      event.preventDefault();
      void writeBrowserLog(`block-external-nav account=${account.id} url=${url}`);
    };
    wc.on("will-navigate", blockExternalNav);
    wc.on("dom-ready", () => {
      this.refitSoon(view, true);
      void prepareLoginPage(account.platform, wc);
    });
    wc.on("did-navigate-in-page", () => this.refitSoon(view));
    wc.on("will-redirect", blockExternalNav);
    const inspect = () => this.scheduleInspect(account, view);
    for (const event of ["did-finish-load", "did-navigate", "did-frame-navigate", "did-redirect-navigation", "did-navigate-in-page", "page-title-updated"] as const)
      wc.on(event as "did-finish-load", inspect);
    this.views.set(account.id, view);
    this.parkView(view);
    return view;
  }

  async show(account: Account, target: "home" | "publish" | "reveal" = "home", type: PublishDraft["type"] = "video") {
    const view = this.ensureView(account);
    if (this.active && this.active !== account.id) {
      const old = this.views.get(this.active);
      if (old) this.parkView(old);
      this.leaveWatchers.get(this.active)?.();
    }
    this.active = account.id;
    this.attachActive(view);
    const url = view.webContents.getURL();
    if (!url || target === "publish") await view.webContents.loadURL(this.urlFor(account, target === "home" ? "home" : "publish", type)).catch(ignoreAborted);
    this.scheduleInspect(account, view, 0);
  }

  async preparePublish(account: Account, type: PublishDraft["type"]) {
    await this.openPublishPage(account, type);
  }

  private async openPublishPage(account: Account, type: PublishDraft["type"]) {
    const view = this.ensureView(account);
    if (this.active === account.id) this.attachActive(view);
    await view.webContents.loadURL(this.urlFor(account, "publish", type)).catch(ignoreAborted).catch(() => undefined);
    return view.webContents;
  }

  private scheduleInspect(account: Account, view: WebContentsView, delay = INSPECT_DEBOUNCE_MS, bump = true) {
    const previous = this.inspectTimers.get(account.id);
    if (previous) clearTimeout(previous);
    const version = (this.inspectVersions.get(account.id) || 0) + (bump ? 1 : 0);
    this.inspectVersions.set(account.id, version);
    const timer = setTimeout(() => {
      this.inspectTimers.delete(account.id);
      void this.inspectAccount(account, view, version);
    }, delay);
    this.inspectTimers.set(account.id, timer);
  }

  private async inspectAccount(account: Account, view: WebContentsView, expectedVersion?: number) {
    const stale = () => expectedVersion !== undefined && this.inspectVersions.get(account.id) !== expectedVersion;
    const result = await this.settle(account, view.webContents, stale);
    if (!result || stale()) return;
    if (result.loggedIn) await this.flushAccountSession(account.id, "login-detected");
    await this.updateAccount(account.id, { loginStatus: result.loggedIn ? "logged_in" : "logged_out", ...(result.loggedIn && result.name ? { name: result.name } : {}) });
  }

  async autoPublish(account: Account, sourceDraft: PublishDraft, progress: PublishProgress, taskId: string = randomUUID()): Promise<PublishResult> {
    const wc = this.ensureView(account).webContents;
    const allowUnload = (event: Electron.Event) => event.preventDefault();
    wc.on("will-prevent-unload", allowUnload);
    try {
      return await this.fill(account, sourceDraft, progress, taskId);
    } finally {
      if (!wc.isDestroyed()) wc.off("will-prevent-unload", allowUnload);
    }
  }

  private async fill(account: Account, sourceDraft: PublishDraft, progress: PublishProgress, taskId: string): Promise<PublishResult> {
    const draft = resolveDraft(sourceDraft, account.platform);
    const name = platformMap[account.platform].name;
    if (isAssisted(account.platform, draft.type)) {
      await progress("opening", "正在为" + name + "准备合规辅助发布");
      return assistedMessage(account, draft, await this.openPublishPage(account, draft.type));
    }
    if (draft.type === "image_text") {
      return publishArticle(account, draft, progress, this.ensureView(account).webContents, this.urlFor(account, "publish", draft.type), taskId);
    }
    const wc = this.ensureView(account).webContents;
    return flows().publishVideo(account, draft, progress, {
      publishUrl: this.urlFor(account, "publish", "video"),
      homeUrl: this.urlFor(account, "home"),
      updateAccount: (update) => this.updateAccount(account.id, update),
      flush: (reason) => this.flushAccountSession(account.id, reason),
    }, wc, taskId);
  }

  async submit(account: Account, type: PublishDraft["type"]) {
    const wc = this.views.get(account.id)?.webContents;
    if (!wc || wc.isDestroyed()) return { ok: false, reason: "发布页已关闭" };
    return autoSubmit(wc, account.platform, type);
  }

  hasView(accountId: string) {
    return this.views.has(accountId);
  }

  async healImages(account: Account) {
    const wc = this.views.get(account.id)?.webContents;
    if (account.platform !== "zhihu" || !wc || wc.isDestroyed()) return 0;
    return healZhihuImages(wc);
  }

  async preview(accountId: string, width = PREVIEW_WIDTH) {
    const wc = this.views.get(accountId)?.webContents;
    if (!wc || wc.isDestroyed() || !wc.getURL()) return "";
    const image = await wc.capturePage().catch(() => undefined);
    if (!image || image.isEmpty()) return "";
    return "data:image/jpeg;base64," + image.resize({ width, quality: "good" }).toJPEG(PREVIEW_QUALITY).toString("base64");
  }

  async saveSnapshot(accountId: string, file: string) {
    const wc = this.views.get(accountId)?.webContents;
    if (!wc || wc.isDestroyed()) return false;
    const image = await wc.capturePage().catch(() => undefined);
    if (!image || image.isEmpty()) return false;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, image.resize({ width: SNAPSHOT_WIDTH, quality: "good" }).toJPEG(PREVIEW_QUALITY));
    return true;
  }

  async openUrl(account: Account, url: string) {
    await this.ensureView(account).webContents.loadURL(url).catch(ignoreAborted).catch(() => undefined);
  }

  /** 用账号自己的登录态开一个隐藏页面跑只读脚本（评论抓取等），跑完立刻销毁，不打扰用户正在看的窗口。 */
  async withHiddenPage<T>(account: Account, run: (wc: Electron.WebContents) => Promise<T>): Promise<T> {
    const hidden = this.hiddenWindow(account);
    try {
      return await run(hidden.webContents);
    } finally {
      await this.flushAccountSession(account.id, "hidden-page");
      if (!hidden.isDestroyed()) hidden.destroy();
    }
  }

  /** 在账号自己的可见视图里打开指定页面并执行脚本（用于把回复填进输入框，最后由人点发送）。 */
  async withAccountPage<T>(account: Account, url: string | undefined, run: (wc: Electron.WebContents) => Promise<T>): Promise<T> {
    const view = this.ensureView(account);
    if (this.active === account.id) this.attachActive(view);
    if (url && view.webContents.getURL() !== url) await view.webContents.loadURL(url).catch(ignoreAborted).catch(() => undefined);
    return run(view.webContents);
  }

  reportLogin(accountId: string, loginStatus: LoginStatus) {
    return this.updateAccount(accountId, { loginStatus });
  }

  async checkPublished(account: Account, title: string, alt: string[] = []): Promise<VerifyResult> {
    const checker = this.hiddenWindow(account);
    if (account.platform === "xiaohongshu") await checker.webContents.loadURL(this.xhsUrl(account, "/")).catch(() => undefined);
    try {
      const overdue = new Promise<VerifyResult>((resolve) =>
        setTimeout(() => resolve({ ok: false, url: checker.isDestroyed() ? "" : checker.webContents.getURL(), reason: "后台确认超时" }), CHECK_PUBLISHED_HARD_LIMIT),
      );
      return await Promise.race([verifyPublishedTitle(checker.webContents, account.platform, title, CHECK_PUBLISHED_TIMEOUT, alt), overdue]);
    } catch (error) {
      return { ok: false, url: checker.webContents.getURL(), reason: error instanceof Error ? error.message : String(error) };
    } finally {
      await this.flushAccountSession(account.id, "check-published");
      if (!checker.isDestroyed()) checker.destroy();
    }
  }

  async probeLogin(account: Account) {
    const probe = this.hiddenWindow(account);
    try {
      await probe.webContents.loadURL(this.urlFor(account, "home")).catch(ignoreAborted);
      return await this.settle(account, probe.webContents);
    } catch (error) {
      void writeBrowserLog("login-probe-error account=" + account.id + " err=" + String(error));
      return undefined;
    } finally {
      if (!probe.isDestroyed()) probe.destroy();
    }
  }

  hide() {
    if (!this.active) return;
    const v = this.views.get(this.active);
    if (v) this.parkView(v);
    const left = this.active;
    this.active = undefined;
    this.leaveWatchers.get(left)?.();
  }

  private leaveWatchers = new Map<string, () => void>();

  watchLeave(accountId: string, onLeave: () => void) {
    this.leaveWatchers.get(accountId)?.();
    const wc = this.views.get(accountId)?.webContents;
    if (!wc) return;
    const pathOf = (url: string) => {
      try {
        return new URL(url).pathname;
      } catch {
        return "";
      }
    };
    const startPath = pathOf(wc.getURL());
    const onNav = (_e: Electron.Event, url: string) => {
      if (pathOf(url) !== startPath) fire();
    };
    const fire = () => {
      this.leaveWatchers.delete(accountId);
      if (!wc.isDestroyed()) {
        wc.off("did-navigate", onNav);
        wc.off("did-navigate-in-page", onNav);
      }
      onLeave();
    };
    wc.on("did-navigate", onNav);
    wc.on("did-navigate-in-page", onNav);
    this.leaveWatchers.set(accountId, fire);
  }

  async close(id: string) {
    const timer = this.inspectTimers.get(id);
    if (timer) clearTimeout(timer);
    this.inspectTimers.delete(id);
    this.inspectVersions.delete(id);
    this.leaveWatchers.get(id)?.();
    const v = this.views.get(id);
    if (!v) return;
    if (this.win.contentView.children.includes(v)) this.win.contentView.removeChildView(v);
    if (this.dock && !this.dock.isDestroyed() && this.dock.contentView.children.includes(v)) this.dock.contentView.removeChildView(v);
    await this.flushAccountSession(id, "view-close");
    v.webContents.close();
    this.views.delete(id);
    if (this.active === id) this.active = undefined;
  }

  setBounds(b: BrowserBounds) {
    this.bounds = {
      x: Math.max(0, Math.round(b.x)),
      y: Math.max(0, Math.round(b.y)),
      width: Math.max(100, Math.round(b.width)),
      height: Math.max(100, Math.round(b.height)),
    };
    this.boundsKnown = true;
    const view = this.active ? this.views.get(this.active) : undefined;
    if (view) this.attachActive(view);
  }

  navigate(action: "back" | "forward" | "reload" | "home", account?: Account) {
    const wc = this.active ? this.views.get(this.active)?.webContents : undefined;
    if (!wc) return;
    if (action === "back" && wc.canGoBack()) wc.goBack();
    if (action === "forward" && wc.canGoForward()) wc.goForward();
    if (action === "reload") wc.reload();
    if (action === "home" && account) void wc.loadURL(this.urlFor(account, "home")).catch(() => undefined);
  }

  async wipeAccountSession(id: string) {
    this.xhsOrigins.delete(id);
    const profile = this.accountSession(id);
    await profile.clearStorageData().catch((error) => writeBrowserLog(`session-wipe-failed account=${id} error=${String(error)}`));
    await profile.clearCache().catch(() => undefined);
    await writeBrowserLog(`session-wiped account=${id}`);
  }

  async destroy() {
    for (const timer of this.inspectTimers.values()) clearTimeout(timer);
    this.inspectTimers.clear();
    this.inspectVersions.clear();
    await Promise.all(Array.from(this.views.keys(), (id) => this.flushAccountSession(id, "application-shutdown")));
    for (const v of this.views.values()) v.webContents.close();
    this.views.clear();
    if (this.dock && !this.dock.isDestroyed()) this.dock.destroy();
    this.dock = undefined;
  }
}
