import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from "electron";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { extractVideoCover } from "./video-cover";
import { JsonStore } from "./store";
import { BrowserManager } from "./browser-manager";
import { canAutoSubmit } from "./submit-rules";
import { attachWindowDiagnostics } from "./runtime-guard";
import { platformMap } from "../shared/platforms";
import { accountLabel, accountWho, groupByPlatform, interleaveByPlatform, normalizeRemark, normalizeSettings } from "../shared/accounts";
import { Notifier } from "./notify";
import { expiredFor, planRemoval, removeFiles } from "./history-cleanup";
import { readBrowserLog, sealOldLog, writeBrowserLog } from "./log-bus";
import { sealPlainFiles } from "./seal-files";
import { PublishControl } from "./publish-control";
import { runScheduled, type WaitReason } from "./publish-scheduler";
import {
  LOGIN_PATROL_ACCOUNT_GAP_MS,
  LOGIN_PATROL_FIRST_DELAY_MS,
  LOGIN_PATROL_INTERVAL_MS,
  MANUAL_PATROL_LANES,
  MANUAL_PATROL_SAME_PLATFORM_GAP_MS,
  loginTransition,
  taskNotification,
} from "./notify-core";
import { contentFor, supportsType, weixinVideoTitle } from "../shared/platform-rules";
import { isDeclaration } from "../shared/declarations";
import { parseDraftInput, upsertDraft } from "../shared/drafts";
import { batchSummary } from "../shared/task-outcome";
import { browserCacheBytes, clearBrowserCache } from "./browser-cache";
import { LicenseManager } from "./license";
import { APP_LINK_KEYS, appInfoView, type AppLinkKey } from "../shared/app-info";
import { DEFAULT_PROMOS } from "../shared/promo";
import { QUOTA_ERROR, TIER_LABELS, canAddAccount, quotaOverflow } from "../shared/license";
import { RULES_MISSING, SAFETY_ERROR, reviewSafety } from "../shared/safety-review";
import { PACK_MISSING } from "../shared/platform-pack";
import { currentPack } from "./platform-pack";
import { effectiveGapMin, pruneLog } from "../shared/pacing";
import { parseSource } from "../shared/copy-check";
import { registerGrabIpc } from "./grab/ipc";
import { lookupIp } from "./public-ip";
import { checkMpHealth } from "./grab/wechat";
import { FP_SCHEME, pathFromSrc } from "../shared/mp-html";
import { registerTutorial, tutorialPrivileges } from "./tutorial";
import { MP_HEALTH_FIRST_DELAY_MS, MP_HEALTH_INTERVAL_MS, healthNotice, type MpHealthState, type MpHealthView } from "../shared/mp-health";
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
import type {
  Account,
  AccountInput,
  AccountPatch,
  BrowserBounds,
  ContentOverrides,
  LoginStatus,
  Platform,
  PlatformContent,
  PublishDraft,
  PublishTask,
  TaskStatus,
} from "../shared/types";
const dir = path.dirname(fileURLToPath(import.meta.url));
const iconPath = app.isPackaged
  ? path.join(process.resourcesPath, "build", "icon.png")
  : path.join(dir, "..", "..", "build", "icon.png");
const DEBUG_SWITCHES = ["remote-debugging-port", "remote-debugging-pipe", "inspect", "inspect-brk", "inspect-port", "js-flags"];
if (app.isPackaged && DEBUG_SWITCHES.some((s) => app.commandLine.hasSwitch(s))) app.exit(1);
const userDataDir =
  process.env.FANPOST_USER_DATA_DIR || (app.isPackaged ? "" : path.join(app.getPath("appData"), "fanpost-dev"));
if (userDataDir) app.setPath("userData", userDataDir);
app.commandLine.appendSwitch("log-level", "3");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
let win: BrowserWindow | null = null;
let composerDirty = false;
let closeConfirmed = false;
let browsers: BrowserManager | null = null;
const license = new LicenseManager();
const LICENSE_TICK_MS = 3600 * 1000;

function assertQuota() {
  const { tier, limit } = license.current();
  if (tier === "none") throw new Error(QUOTA_ERROR + "还没有激活授权。激活卡密后才能使用全部功能（添加账号、一键填写和发布、公众号、采集导入）。");
  const over = quotaOverflow(store.get().accounts, limit);
  if (!over.length) return;
  const detail = over.map((o) => platformMap[o.platform].name + " " + o.count + " 个").join("、");
  throw new Error(QUOTA_ERROR + "当前是" + TIER_LABELS[tier] + "，每个平台最多 " + limit + " 个账号，超出的有：" + detail + "。请升级授权，或删掉多余的账号后再发布。");
}
function assertSafety(draft: Omit<PublishDraft, "id" | "createdAt">) {
  const rules = license.safetyRules();
  if (!rules) throw new Error(SAFETY_ERROR + RULES_MISSING);
  if (!currentPack()) throw new Error(SAFETY_ERROR + PACK_MISSING);
  const data = store.get();
  const blocks = reviewSafety(rules, { draft, accounts: data.accounts, log: data.publishLog, source: draft.source, now: Date.now() }).filter((i) => i.level === "block");
  if (blocks.length) throw new Error(SAFETY_ERROR + "安全检查没通过：" + blocks.map((b) => b.text).join("；"));
}
async function logFill(task: PublishTask) {
  const now = Date.now();
  await store.update((d) => {
    d.publishLog = [...pruneLog(d.publishLog, now), { accountId: task.accountId, platform: task.platform, at: new Date(now).toISOString() }];
  });
}
let quittingAfterSessionFlush = false;
const isBlockedScheme = (url: string) =>
  !/^(https?|devtools|about|blob|data|chrome|file):/i.test(url) &&
  !/^(mailto|tel):/i.test(url);
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-frame-navigate", (e) => {
    if (isBlockedScheme(e.url)) e.preventDefault();
  });
  contents.on("will-navigate", (e, url) => {
    if (isBlockedScheme(url)) e.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isBlockedScheme(url)) return { action: "deny" };
    return { action: "allow" };
  });
});
const store = new JsonStore();
const notifier = new Notifier(store, () => win);
let patrolTimer: ReturnType<typeof setTimeout> | undefined;
let patrolRunning = false;
let publishRunning = false;
let runningDraftId: string | undefined;
const publishControl = new PublishControl((state) => win?.webContents.send("publish:state", state));
async function dropDrafts(draftIds: string[]) {
  if (!draftIds.length) return 0;
  const dropping = new Set(draftIds);
  for (const t of store.get().tasks) if (dropping.has(t.draftId)) cancelAutoVerify(t.id);
  const { next, files } = planRemoval(store.get(), draftIds);
  await store.update((d) => {
    d.drafts = next.drafts;
    d.tasks = next.tasks;
    d.notifications = next.notifications;
  });
  await removeFiles(files);
  await writeBrowserLog(`history-pruned drafts=${draftIds.length} files=${files.length}`);
  win?.webContents.send("data:changed");
  return draftIds.length;
}
const pruneHistory = () => dropDrafts(expiredFor(store.get(), Date.now(), runningDraftId ? [runningDraftId] : []));
async function notifyLoginChange(
  accountId: string,
  account: { platform: Platform; name: string; remark?: string },
  previous: LoginStatus | undefined,
  next: LoginStatus,
) {
  const edge = loginTransition(previous, next);
  const who = accountWho(account);
  if (edge === "offline")
    await notifier.notify({
      level: "error",
      kind: "account_offline",
      title: who + " 已掉线",
      message: "请到账号管理重新扫码登录，否则该账号的发布任务会失败。",
      accountId,
    });
  else if (edge === "online")
    await notifier.notify(
      {
        level: "success",
        kind: "account_offline",
        title: who + " 已恢复登录",
        message: "账号登录状态已恢复正常。",
        accountId,
      },
      { system: false },
    );
}
let mpHealthState: MpHealthState | undefined;
async function onMpHealth(h: MpHealthView) {
  const notice = healthNotice(mpHealthState, h);
  if (h.state !== "offline") mpHealthState = h.state;
  win?.webContents.send("mp:health", h);
  if (notice) await notifier.notify({ ...notice, kind: "mp_health" }, notice.level === "success" ? { system: false } : {});
}
function scheduleMpHealth(delay: number) {
  setTimeout(() => {
    void checkMpHealth()
      .then(onMpHealth)
      .catch((e) => writeBrowserLog("mp-health-error " + String(e)))
      .finally(() => scheduleMpHealth(MP_HEALTH_INTERVAL_MS));
  }, delay);
}
const IMAGE_FILE = /\.(jpe?g|png|webp|gif)$/i;
function registerImageProtocol() {
  protocol.handle(FP_SCHEME, async (req) => {
    const raw = pathFromSrc(req.url);
    if (!raw || !path.isAbsolute(raw) || !IMAGE_FILE.test(raw)) return new Response("", { status: 404 });
    const stat = await fs.stat(raw).catch(() => undefined);
    if (!stat?.isFile() || stat.size > MAX_THUMB_BYTES) return new Response("", { status: 404 });
    return net.fetch(pathToFileURL(raw).href);
  });
}
async function runLoginPatrol(manual = false) {
  if (patrolRunning || !browsers) return { checked: 0, offline: 0, skipped: true };
  if (publishRunning && !manual) return { checked: 0, offline: 0, skipped: true };
  patrolRunning = true;
  let checked = 0,
    done = 0;
  const accounts = store.get().accounts;
  const probe = async (account: Account) => {
    if (manual) win?.webContents.send("patrol:progress", { done, total: accounts.length, accountId: account.id, state: "checking" });
    const result = await browsers?.probeLogin(account);
    if (result) {
      checked++;
      await browsers?.reportLogin(account.id, result.loggedIn ? "logged_in" : "logged_out");
    }
    done++;
    const state = result ? (result.loggedIn ? "online" : "offline") : "unknown";
    if (manual) win?.webContents.send("patrol:progress", { done, total: accounts.length, accountId: account.id, state });
  };
  try {
    if (manual) {
      const queues = groupByPlatform(accounts);
      let next = 0;
      const lane = async () => {
        for (let q = queues[next++]; q; q = queues[next++])
          for (const [index, account] of q.entries()) {
            if (index > 0) await sleep(MANUAL_PATROL_SAME_PLATFORM_GAP_MS);
            await probe(account);
          }
      };
      win?.webContents.send("patrol:progress", { done, total: accounts.length });
      await Promise.all(Array.from({ length: publishRunning ? 1 : MANUAL_PATROL_LANES }, lane));
    } else
      for (const [index, account] of accounts.entries()) {
        if (index > 0) await sleep(LOGIN_PATROL_ACCOUNT_GAP_MS);
        await probe(account);
      }
  } finally {
    patrolRunning = false;
  }
  const offline = store.get().accounts.filter((a) => a.loginStatus === "logged_out").length;
  return { checked, offline, skipped: false };
}
function scheduleLoginPatrol(delay = LOGIN_PATROL_FIRST_DELAY_MS) {
  if (patrolTimer) clearTimeout(patrolTimer);
  patrolTimer = setTimeout(async () => {
    await runLoginPatrol().catch((error) =>
      writeBrowserLog("login-patrol-error " + String(error)),
    );
    scheduleLoginPatrol(LOGIN_PATROL_INTERVAL_MS);
  }, delay);
}
const MAX_OVERRIDE_TEXT = 20000;
const MAX_THUMB_BYTES = 15 * 1024 * 1024;
const THUMB_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
function sanitizeOverrides(value: unknown): ContentOverrides | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: ContentOverrides = {};
  for (const [platform, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!(platform in platformMap) || !raw || typeof raw !== "object") continue;
    const src = raw as Record<string, unknown>;
    const content: PlatformContent = {};
    if (typeof src.title === "string") content.title = src.title.slice(0, MAX_OVERRIDE_TEXT);
    if (typeof src.description === "string")
      content.description = src.description.slice(0, MAX_OVERRIDE_TEXT);
    if (Array.isArray(src.topics))
      content.topics = src.topics.filter((t): t is string => typeof t === "string").slice(0, 50);
    if (typeof src.coverPath === "string") content.coverPath = src.coverPath;
    if (typeof src.question === "string" && src.question.trim()) content.question = src.question.trim().slice(0, 300);
    if (typeof src.zone === "string" && src.zone.trim()) content.zone = src.zone.trim().slice(0, 20);
    if (Object.keys(content).length) result[platform as Platform] = content;
  }
  return Object.keys(result).length ? result : undefined;
}
async function notifyTask(taskId: string) {
  const data = store.get();
  const task = data.tasks.find((t) => t.id === taskId);
  const account = data.accounts.find((a) => a.id === task?.accountId);
  if (!task || !account) return;
  const input = taskNotification(
    task.status,
    platformMap[account.platform].name,
    accountLabel(account),
    task.title,
    task.message,
  );
  if (input) await notifier.notify({ ...input, accountId: account.id, taskId: task.id });
}
const AUTO_VERIFY_DELAYS_MS = [20_000, 120_000, 600_000];
const AUTO_SUBMIT_VERIFY_DELAY_MS = 8000;
const NAV_CONFIRMS_PUBLISH: Platform[] = ["qqmedia"];
const VIDEO_TASK_LIMIT_MS = 12 * 60000;
const IMAGE_TASK_LIMIT_MS = 5 * 60000;
const verifyTimers = new Map<string, ReturnType<typeof setTimeout>>();
const verifying = new Set<string>();
const overdueTasks = new Set<string>();
async function verifyTask(id: string, manual: boolean): Promise<{ ok: boolean; reason?: string }> {
  const data = store.get(),
    task = data.tasks.find((x) => x.id === id),
    account = data.accounts.find((x) => x.id === task?.accountId),
    draft = data.drafts.find((x) => x.id === task?.draftId);
  if (!task || !account || !draft || !browsers) {
    if (manual) throw new Error("任务或账号不存在");
    return { ok: false, reason: "任务或账号不存在" };
  }
  if (task.status === "success") return { ok: true };
  if (verifying.has(id)) return { ok: false, reason: "正在检查中" };
  verifying.add(id);
  try {
    const content = contentFor(draft, account.platform);
    const title = account.platform === "weixin" && draft.type === "video" ? weixinVideoTitle(content.title, content.description) : content.title;
    const alt = account.platform === "weixin" ? [content.description] : [];
    const result = await browsers.checkPublished(account, title, alt);
    if (result.ok) {
      cancelAutoVerify(id);
      await store.update((d) => {
        const t = d.tasks.find((x) => x.id === id);
        if (t)
          Object.assign(t, {
            status: "success",
            message: manual ? "后台已找到该作品，发布成功" : "已自动确认：后台找到该作品，发布成功",
            ...(/^https?:\/\//i.test(result.url) ? { publishedUrl: result.url } : {}),
            updatedAt: new Date().toISOString(),
          });
      });
      await notifyTask(id);
      await pruneHistory();
    } else if (manual)
      await notifier.notify(
        {
          level: "info",
          kind: "check_result",
          title: accountWho(account) + " 暂未找到已发布作品",
          message: (result.reason || "作品管理里没有该标题") + "。平台审核中或还没点发布时属正常，稍后可再查。",
          accountId: account.id,
          taskId: id,
        },
        { system: false },
      );
    win?.webContents.send("data:changed");
    return { ok: result.ok, reason: result.reason };
  } finally {
    verifying.delete(id);
  }
}
async function giveUpAutoVerify(id: string) {
  const task = store.get().tasks.find((t) => t.id === id);
  if (task?.status !== "manual_required" || !/^已自动点击发布/.test(task.message)) return;
  await store.update((d) => {
    const t = d.tasks.find((x) => x.id === id);
    if (t) Object.assign(t, { message: "自动发布未确认：已点过发布，但平台后台一直没查到这条。请点「打开发布页」看是否被验证或报错拦下，发出后点「检查是否已发布」。", updatedAt: new Date().toISOString() });
  });
  win?.webContents.send("data:changed");
  await notifyTask(id);
}
function cancelAutoVerify(id: string) {
  const timer = verifyTimers.get(id);
  if (timer) clearTimeout(timer);
  verifyTimers.delete(id);
}
function scheduleAutoVerify(id: string, attempt = 0) {
  cancelAutoVerify(id);
  if (attempt >= AUTO_VERIFY_DELAYS_MS.length) {
    void giveUpAutoVerify(id);
    return;
  }
  verifyTimers.set(
    id,
    setTimeout(async () => {
      verifyTimers.delete(id);
      if (store.get().tasks.find((t) => t.id === id)?.status !== "manual_required") return;
      const r = await verifyTask(id, false).catch((e) => {
        writeBrowserLog("auto-verify-error task=" + id + " err=" + String(e));
        return { ok: false };
      });
      if (!r.ok) scheduleAutoVerify(id, attempt + 1);
    }, AUTO_VERIFY_DELAYS_MS[attempt]),
  );
}
async function dismissTasks(match: (t: PublishTask) => boolean) {
  await store.update((d) => {
    for (const t of d.tasks)
      if (t.status === "manual_required" && match(t)) {
        cancelAutoVerify(t.id);
        Object.assign(t, { status: "dismissed", message: "已忽略，不再提醒。需要时可在发布记录里重新打开发布页。", updatedAt: new Date().toISOString() });
      }
  });
  await pruneHistory();
}
async function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#eef1f0",
    title: "浪叉多平台发布助手",
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(dir, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  attachWindowDiagnostics(win);
  browsers = new BrowserManager(win, async (id, update) => {
    let changed = false,
      previous: LoginStatus | undefined,
      snapshot: { platform: Platform; name: string; remark?: string } | undefined;
    await store.update((d) => {
      const account = d.accounts.find((x) => x.id === id);
      if (!account) return;
      previous = account.loginStatus;
      changed = Object.entries(update).some(
        ([key, value]) => account[key as keyof typeof account] !== value,
      );
      if (changed) Object.assign(account, update);
      snapshot = { platform: account.platform, name: account.name, remark: account.remark };
    });
    if (changed) win?.webContents.send("data:changed");
    if (update.loginStatus && snapshot)
      await notifyLoginChange(id, snapshot, previous, update.loginStatus);
  });
  scheduleLoginPatrol();
  if (process.env.ELECTRON_RENDERER_URL)
    await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await win.loadFile(path.join(dir, "../../dist/index.html"));
  win.on("close", (event) => {
    if (!composerDirty || closeConfirmed || !win) return;
    event.preventDefault();
    win.webContents.send("app:close-request");
  });
  win.on("closed", () => {
    if (process.platform === "darwin") {
      void browsers?.destroy();
      browsers = null;
    }
    win = null;
  });
}
function ipc() {
  ipcMain.handle("data:get", () => store.get());
  ipcMain.handle("data:recovery", () => store.getRecovery());
  ipcMain.handle("browser:close", (_e, id: string) => browsers?.close(id));
  ipcMain.handle("account:add", (_e, input: AccountInput) => {
    const { tier, limit } = license.current();
    if (tier === "none") throw new Error(QUOTA_ERROR + "还没有激活授权。激活卡密后才能使用全部功能（添加账号、一键填写和发布、公众号、采集导入）。");
    if (!canAddAccount(store.get().accounts, input.platform, limit))
      throw new Error(QUOTA_ERROR + "当前是" + TIER_LABELS[tier] + "，每个平台最多 " + limit + " 个账号，" + platformMap[input.platform].name + "已经满了。请升级授权后再添加。");
    return store.update((d) => {
      d.accounts.push({
        id: randomUUID(),
        platform: input.platform,
        name: platformMap[input.platform].name + "账号",
        loginStatus: "logged_out",
        createdAt: new Date().toISOString(),
      });
    });
  });
  ipcMain.handle("account:update", (_e, id: string, patch: AccountPatch) =>
    store.update((d) => {
      const account = d.accounts.find((x) => x.id === id);
      if (!account) throw new Error("账号不存在");
      if (patch && "remark" in patch) account.remark = normalizeRemark(patch.remark) || undefined;
    }),
  );
  ipcMain.handle("settings:update", (_e, patch: unknown) =>
    store.update((d) => {
      d.settings = normalizeSettings({ ...d.settings, ...(patch && typeof patch === "object" ? patch : {}) });
    }).then(async () => {
      await pruneHistory();
      return store.get();
    }),
  );
  const licenseView = () => ({ ...license.current(), machine: license.machineCode(), over: quotaOverflow(store.get().accounts, license.current().limit) });
  ipcMain.handle("license:get", () => licenseView());
  registerGrabIpc({
    win: () => win,
    getData: () => store.get(),
    update: (fn) => store.update(fn),
    rules: () => license.safetyRules(),
    onHealth: (h) => void onMpHealth(h),
    assertLicensed: () => {
      if (license.current().tier === "none") throw new Error(QUOTA_ERROR + "还没有激活授权。激活卡密后才能使用全部功能（添加账号、一键填写和发布、公众号、采集导入）。");
    },
  });
  if (!app.isPackaged) ipcMain.handle("dev:log", (_e, n: unknown) => readBrowserLog(typeof n === "number" ? n : 200));
  ipcMain.handle("net:ip", (_e, force: unknown) => lookupIp(force === true));
  ipcMain.handle("safety:rules", () => ({ rules: license.safetyRules() ?? null, ...license.rulesInfo() }));
  ipcMain.handle("license:activate", async (_e, key: unknown) => {
    if (typeof key !== "string") throw new Error("卡密格式不对");
    await license.activate(key);
    await license.refreshRules(true);
    return licenseView();
  });
  ipcMain.handle("license:refresh", async () => {
    await license.refresh(true);
    await license.refreshRules(true);
    return licenseView();
  });
  ipcMain.handle("license:unbind", async () => {
    if (publishControl.current !== "idle") throw new Error("正在填写或发布，等这一批结束后再解绑");
    await license.unbind();
    return licenseView();
  });
  ipcMain.handle("app:info", async (_e, force: unknown) => appInfoView(app.getVersion(), await license.appInfo(force === true)));
  ipcMain.handle("app:open-link", async (_e, key: unknown) => {
    if (!APP_LINK_KEYS.includes(key as AppLinkKey)) throw new Error("未知链接");
    const url = (await license.appInfo())[key as AppLinkKey];
    if (!url) throw new Error("链接还没配置");
    await shell.openExternal(url);
  });
  ipcMain.handle("app:open-url", async (_e, raw: unknown) => {
    const url = typeof raw === "string" ? raw.trim() : "";
    const info = await license.appInfo();
    const known = [...(info.promos ?? DEFAULT_PROMOS).map((p) => p.url), ...(info.notices ?? []).map((n) => n.url)].filter(Boolean);
    if (!known.includes(url) || !/^https:\/\//i.test(url)) throw new Error("这个链接不能打开");
    await shell.openExternal(url);
  });
  ipcMain.handle("cache:size",() => browserCacheBytes(store.get().accounts.map((a) => a.id)));
  ipcMain.handle("cache:clear", async () => {
    if (publishControl.current !== "idle") throw new Error("正在填写或发布，等这一批结束后再清理");
    return clearBrowserCache(store.get().accounts.map((a) => a.id));
  });
  ipcMain.handle("history:clear", async () => {
    const data = store.get();
    const removed = await dropDrafts(data.drafts.filter((d) => d.id !== runningDraftId).map((d) => d.id));
    return { removed, data: store.get() };
  });
  ipcMain.handle("history:remove", async (_e, ids: unknown) => {
    const wanted = new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : []);
    const draftIds = store.get().drafts.filter((d) => wanted.has(d.id) && d.id !== runningDraftId).map((d) => d.id);
    const removed = await dropDrafts(draftIds);
    return { removed, data: store.get() };
  });
  ipcMain.handle("account:remove", async (_e, id: string) => {
    await browsers?.close(id);
    await browsers?.wipeAccountSession(id);
    for (const t of store.get().tasks) if (t.accountId === id) cancelAutoVerify(t.id);
    await store.update((d) => {
      const gone = new Set(d.tasks.filter((x) => x.accountId === id).map((x) => x.id));
      d.accounts = d.accounts.filter((x) => x.id !== id);
      d.tasks = d.tasks.filter((x) => x.accountId !== id);
      d.notifications = d.notifications.filter((n) => n.accountId !== id && !(n.taskId && gone.has(n.taskId)));
      for (const type of ["video", "image_text"] as const) {
        d.accountSelections[type] = (d.accountSelections[type] || []).filter(
          (accountId) => accountId !== id,
        );
      }
    });
    const empty = store.get().drafts.filter((x) => x.id !== runningDraftId && !store.get().tasks.some((t) => t.draftId === x.id)).map((x) => x.id);
    await dropDrafts(empty);
    return store.get();
  });
  ipcMain.handle(
    "browser:show",
    async (_e, id: string, target: "home" | "publish" | "reveal" = "home") => {
      const a = store.get().accounts.find((x) => x.id === id);
      if (!a) throw new Error("账号不存在");
      await browsers?.show(a, target);
    },
  );
  ipcMain.handle("browser:hide", () => browsers?.hide());
  ipcMain.handle("browser:bounds", (_e, b: BrowserBounds) =>
    browsers?.setBounds(b),
  );
  ipcMain.handle(
    "browser:navigate",
    (_e, a: "back" | "forward" | "reload" | "home", id: string) =>
      browsers?.navigate(
        a,
        store.get().accounts.find((x) => x.id === id),
      ),
  );
  ipcMain.handle("video:cover", async (_e, videoPath: string) => {
    try {
      return { ok: true, ...(await extractVideoCover(videoPath)) };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  ipcMain.handle(
    "file:pick",
    async (_e, kind: "video" | "images" | "cover") => {
      if (!win) return [];
      const r = await dialog.showOpenDialog(win, {
        properties:
          kind === "images" ? ["openFile", "multiSelections"] : ["openFile"],
        filters:
          kind === "video"
            ? [{ name: "视频", extensions: ["mp4", "mov", "mkv", "webm"] }]
            : [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp"] }],
      });
      if (r.canceled) return [];
      return r.filePaths;
    },
  );
  ipcMain.handle("file:thumb", async (_e, filePath: unknown) => {
    if (typeof filePath !== "string" || !path.isAbsolute(filePath)) return "";
    const ext = path.extname(filePath).toLowerCase();
    const mime = THUMB_MIME[ext];
    if (!mime) return "";
    const stat = await fs.stat(filePath).catch(() => undefined);
    if (!stat?.isFile() || stat.size > MAX_THUMB_BYTES) return "";
    const bytes = await fs.readFile(filePath);
    return "data:" + mime + ";base64," + bytes.toString("base64");
  });
  ipcMain.handle("draft:save", async (_e, id: unknown, raw: unknown) => {
    const input = parseDraftInput(raw);
    if (!input) throw new Error("草稿数据无效");
    const draftId = typeof id === "string" && id ? id : randomUUID();
    const data = await store.update((d) => {
      d.savedDrafts = upsertDraft(d.savedDrafts, input, draftId, new Date().toISOString());
    });
    return { id: draftId, data };
  });
  ipcMain.handle("draft:remove", (_e, id: unknown) =>
    store.update((d) => {
      d.savedDrafts = d.savedDrafts.filter((x) => x.id !== id);
    }),
  );
  ipcMain.handle(
    "publish:create",
    async (_e, draft: Omit<PublishDraft, "id" | "createdAt">) => {
      assertQuota();
      const source = parseSource(draft.source);
      draft = { ...draft, source };
      assertSafety(draft);
      if (draft.type === "video" && draft.mediaPaths[0]) {
        try {
          draft.coverPath = (await extractVideoCover(draft.mediaPaths[0])).path;
        } catch {
          draft.coverPath = undefined;
        }
      }
      const now = new Date().toISOString(),
        created = {
          ...draft,
          declaration: isDeclaration(draft.declaration) ? draft.declaration : undefined,
          original: draft.original === true ? true : undefined,
          overrides: sanitizeOverrides(draft.overrides),
          id: randomUUID(),
          createdAt: now,
        };
      return store.update((d) => {
        d.drafts.unshift(created);
        for (const id of created.accountIds) {
          const a = d.accounts.find((x) => x.id === id);
          if (a && supportsType(a.platform, created.type))
            d.tasks.unshift({
              id: randomUUID(),
              draftId: created.id,
              accountId: id,
              platform: a.platform,
              title: contentFor(created, a.platform).title,
              status: "pending",
              message: "等待自动发布",
              createdAt: now,
              updatedAt: now,
            });
        }
      });
    },
  );
  ipcMain.handle("publish:auto", async (_e, draftId: string) => {
    const draft = store.get().drafts.find((x) => x.id === draftId);
    if (!draft) throw new Error("发布内容不存在");
    assertQuota();
    if (!license.safetyRules()) throw new Error(SAFETY_ERROR + RULES_MISSING);
    if (!currentPack()) throw new Error(SAFETY_ERROR + PACK_MISSING);
    if (publishRunning)
      throw new Error("已有一批发布任务在进行中，请等这一批填写完成后再开始下一批（视频和图文分批进行）。");
    publishRunning = true;
    runningDraftId = draft.id;
    publishControl.start();
    try {
      await runPublishBatch(draft);
    } finally {
      publishRunning = false;
      runningDraftId = undefined;
      publishControl.finish();
      if (store.get().tasks.some((t) => t.draftId === draft.id && t.status === "pending")) {
        await store.update((d) => {
          for (const t of d.tasks)
            if (t.draftId === draft.id && t.status === "pending")
              Object.assign(t, { status: "failed", message: "这一批已结束，这一条没开始填写。需要时可重新发布。", updatedAt: new Date().toISOString() });
        });
        win?.webContents.send("data:changed");
      }
    }
    await pruneHistory();
    return store.get();
  });
  ipcMain.handle("publish:state", () => publishControl.current);
  ipcMain.handle("publish:pause", () => publishControl.pause());
  ipcMain.handle("publish:resume", () => publishControl.resume());
  ipcMain.handle("publish:stop", () => publishControl.stop());
  async function setWaiting(taskId: string, message: string) {
    await store.update((d) => {
      const current = d.tasks.find((x) => x.id === taskId);
      if (current) Object.assign(current, { message, updatedAt: new Date().toISOString() });
    });
    win?.webContents.send("data:changed");
  }
  async function runWithDeadline(task: PublishTask, draft: PublishDraft) {
    const limit = draft.type === "video" ? VIDEO_TASK_LIMIT_MS : IMAGE_TASK_LIMIT_MS;
    let timer: NodeJS.Timeout | undefined;
    const overdue = new Promise<"overdue">((resolve) => (timer = setTimeout(() => resolve("overdue"), limit)));
    const running = runPublishTask(task, draft).then(() => "done" as const);
    const outcome = await Promise.race([running, overdue]);
    clearTimeout(timer);
    if (outcome === "done") {
      overdueTasks.delete(task.id);
      return;
    }
    overdueTasks.add(task.id);
    void running.catch(() => undefined).finally(() => overdueTasks.delete(task.id));
    const current = store.get().tasks.find((x) => x.id === task.id);
    if (!current || current.status === "success") return;
    const clicked = /^(已自动点击发布|已填好，正在自动点击发布)/.test(current.message || "");
    await store.update((d) => {
      const t = d.tasks.find((x) => x.id === task.id);
      if (t)
        Object.assign(t, {
          status: "manual_required",
          message: clicked
            ? "已自动点击发布，超过 " + limit / 60000 + " 分钟还没确认到，先跳过去发后面的号，后台会继续自动复查。也可以点「检查后台」。"
            : "超过 " + limit / 60000 + " 分钟没完成（停在：" + (current.message || "未知步骤").slice(0, 40) + "），已跳过去发后面的号。请点「打开发布页」看现场。",
          updatedAt: new Date().toISOString(),
        });
    });
    await writeBrowserLog("task-overdue id=" + task.id + " platform=" + task.platform + " clicked=" + clicked);
    if (clicked) scheduleAutoVerify(task.id);
    win?.webContents.send("data:changed");
    await notifyTask(task.id);
  }
  async function runPublishTask(task: PublishTask, draft: PublishDraft) {
    const account = store.get().accounts.find((x) => x.id === task.accountId);
    if (!account || !browsers) return;
    await logFill(task);
    await setWaiting(task.id, "正在开始填写");
    const progress = async (status: TaskStatus, message: string) => {
      if (overdueTasks.has(task.id)) return;
      await store.update((d) => {
        const current = d.tasks.find((x) => x.id === task.id);
        if (current) Object.assign(current, { status, message, updatedAt: new Date().toISOString() });
      });
      win?.webContents.send("data:changed");
    };
    let filled = false;
    try {
      const result = await browsers.autoPublish(account, draft, progress, task.id);
      await progress(result.status, result.message);
      filled = result.status === "manual_required" && !/登录已失效|未就绪|未定位|出错|未生效|有误|未找到/.test(result.message);
    } catch (error) {
      await progress("failed", "自动发布任务异常：" + (error instanceof Error ? error.message : String(error)));
    }
    await saveTaskSnapshot(task.id, account.id);
    if (filled && draft.autoSubmit && canAutoSubmit(account.platform, draft.type) && !overdueTasks.has(task.id)) {
      await progress("publishing", "已填好，正在自动点击发布");
      const submitted = await browsers.submit(account, draft.type).catch((e) => ({ ok: false, reason: String(e) }));
      if (!submitted.ok && "captcha" in submitted && submitted.captcha) {
        await progress("manual_required", "自动发布未完成：" + submitted.reason + "。请点「打开发布页」完成验证，验证通过后如果页面没自动发出，再点一次「发布」；发出后会自动确认。");
        scheduleAutoVerify(task.id);
      } else if (!submitted.ok) await progress("manual_required", "自动发布未完成：" + submitted.reason + "。内容已填好，请检查后手动点发布。");
      else if ("settled" in submitted && submitted.settled === false && NAV_CONFIRMS_PUBLISH.includes(account.platform)) {
        await progress("manual_required", "点了「发布」后页面没有跳转，可能没真正发出去。请点「打开发布页」看是否有未填项或验证拦截，确认后手动点发布。");
      } else {
        await progress("manual_required", "已自动点击发布，正在到平台后台确认");
        await sleep(AUTO_SUBMIT_VERIFY_DELAY_MS);
        const verified = await verifyTask(task.id, false).catch(() => ({ ok: false }));
        if (!verified.ok) {
          await progress("manual_required", "已自动点击发布，平台后台暂未查到（可能在审核中），稍后会自动再查");
          scheduleAutoVerify(task.id);
        }
      }
    }
    if (!overdueTasks.has(task.id)) await notifyTask(task.id);
  }
  async function saveTaskSnapshot(taskId: string, accountId: string) {
    const file = path.join(app.getPath("userData"), "task-artifacts", "snap-" + taskId + ".jpg");
    const saved = await browsers?.saveSnapshot(accountId, file).catch((error) => {
      void writeBrowserLog(`snapshot-failed task=${taskId} error=${String(error)}`);
      return false;
    });
    if (!saved) return;
    await store.update((d) => {
      const t = d.tasks.find((x) => x.id === taskId);
      if (t) t.snapshotPath = file;
    });
    win?.webContents.send("data:changed");
  }
  async function waitForTurn(task: PublishTask, ms: number, reason: WaitReason, shown: Set<string>) {
    const minutes = ms >= 120000 ? "约 " + Math.round(ms / 60000) + " 分钟" : "约 " + Math.max(1, Math.round(ms / 1000)) + " 秒";
    if (reason === "same-platform") await setWaiting(task.id, "同平台账号错开：" + minutes + "后开始填写");
    if (reason === "slot" && !shown.has(task.id)) {
      shown.add(task.id);
      await setWaiting(task.id, "排队中：同时填写的账号已满，有空位后开始");
    }
    let wasPaused = false;
    const go = await publishControl.wait(ms, sleep, async () => {
      wasPaused = true;
      await setWaiting(task.id, "已暂停：点「继续」后开始填写");
    });
    if (go && wasPaused) await setWaiting(task.id, "已继续，等待开始填写");
    return go;
  }
  async function runPublishBatch(draft: PublishDraft) {
    const draftId = draft.id;
    const tasks = interleaveByPlatform(store.get().tasks.filter((x) => x.draftId === draftId && x.status !== "success").reverse());
    const settings = () => store.get().settings;
    const shown = new Set<string>();
    const queue = await runScheduled(tasks, {
      limit: () => (draft.type === "video" ? settings().videoConcurrency : settings().imageConcurrency),
      samePlatformGapMs: () => effectiveGapMin(license.safetyRules()?.pacing, settings().samePlatformGapMin) * 60000,
      now: Date.now,
      wait: (task, ms, reason) => waitForTurn(task, ms, reason, shown),
      run: (task) => runWithDeadline(task, draft),
    });
    if (queue.length) {
      const stoppedIds = new Set(queue.map((t) => t.id));
      await store.update((d) => {
        for (const t of d.tasks)
          if (stoppedIds.has(t.id) && t.status === "pending")
            Object.assign(t, { status: "failed", message: "已手动停止，未填写。需要时可重新发布这一条。", updatedAt: new Date().toISOString() });
      });
      win?.webContents.send("data:changed");
    }
    const done = store.get().tasks.filter((t) => t.draftId === draftId);
    const summary = batchSummary(done, !!draft.autoSubmit, (p) => platformMap[p].name);
    await notifier.notify({
      level: summary.failed || (draft.autoSubmit && summary.needsYou) ? "warning" : "info",
      kind: "batch_done",
      title: (draft.type === "video" ? "视频" : "图文") + (queue.length ? "批次已停止" : draft.autoSubmit ? "自动发布结束" : "批次填写完成") + (draft.autoSubmit ? "（" + summary.head + "）" : "") + "：" + draft.title,
      message: summary.message + (queue.length ? "其中 " + queue.length + " 个因手动停止未填写。" : "") + (summary.needsYou && draft.autoSubmit ? "到通知中心「待你点发布」逐个处理。" : ""),
      taskId: draftId,
    });
  }
  ipcMain.handle("task:open", async (_e, id: string) => {
    const data = store.get(),
      task = data.tasks.find((x) => x.id === id),
      account = data.accounts.find((x) => x.id === task?.accountId);
    if (!task || !account) throw new Error("任务或账号不存在");
    const watch = () => {
      cancelAutoVerify(id);
      browsers?.watchLeave(account.id, () => {
        if (store.get().tasks.find((t) => t.id === id)?.status === "manual_required") scheduleAutoVerify(id);
      });
    };
    if (browsers?.hasView(account.id)) {
      watch();
      void browsers.healImages(account).catch(() => 0);
      return store.update((d) => {
        const t = d.tasks.find((x) => x.id === id);
        if (!t) return;
        t.openedAt = new Date().toISOString();
        if (t.status === "dismissed") Object.assign(t, { status: "manual_required", message: "已重新打开发布页，请检查并完成发布", updatedAt: t.openedAt });
        if (t.status === "failed") Object.assign(t, { status: "manual_required", message: "之前自动填写失败：" + t.message.replace(/。发布页还停在这个账号里.*$/, "") + "。已打开发布页，请按页面现场补齐后手动点发布，发出后会自动确认。", updatedAt: t.openedAt });
      });
    }
    const type = data.drafts.find((x) => x.id === task.draftId)?.type || "video";
    await browsers?.preparePublish(account, type);
    watch();
    return store.update((d) => {
      const t = d.tasks.find((x) => x.id === id);
      if (t)
        Object.assign(t, {
          status: "manual_required",
          message: "官方发布页已打开，请检查并完成发布",
          openedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
    });
  });
  ipcMain.handle("task:preview", async (_e, id: unknown) => {
    const task = store.get().tasks.find((x) => x.id === id);
    if (!task) return { live: "", snapshot: "" };
    const running = ["opening", "uploading", "publishing"].includes(task.status);
    const live = running && browsers ? await browsers.preview(task.accountId) : "";
    let snapshot = "";
    if (!running && task.snapshotPath) {
      const bytes = await fs.readFile(task.snapshotPath).catch(() => undefined);
      if (bytes) snapshot = "data:image/jpeg;base64," + bytes.toString("base64");
    }
    return { live, snapshot };
  });
  ipcMain.handle("task:open-published", async (_e, id: unknown) => {
    const data = store.get(),
      task = data.tasks.find((x) => x.id === id),
      account = data.accounts.find((x) => x.id === task?.accountId);
    if (!task?.publishedUrl || !account || !browsers) throw new Error("没有可打开的作品页");
    await browsers.openUrl(account, task.publishedUrl);
  });
  ipcMain.handle("task:complete", async (_e, id: string) => {
    await store.update((d) => {
      const t = d.tasks.find((x) => x.id === id);
      if (t)
        Object.assign(t, {
          status: "success",
          message: "发布成功（手动标记）",
          updatedAt: new Date().toISOString(),
        });
    });
    await pruneHistory();
    return store.get();
  });
  ipcMain.handle("task:check", async (_e, id: string) => {
    const result = await verifyTask(id, true);
    return { ...result, data: store.get() };
  });
  ipcMain.handle("task:dismiss", async (_e, ids: unknown) => {
    const wanted = new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : []);
    await dismissTasks((t) => wanted.has(t.id));
    return store.get();
  });
  ipcMain.handle("task:dismiss-all", async () => {
    await dismissTasks(() => true);
    return store.get();
  });
  ipcMain.handle("notification:read", (_e, ids: string[] | "all") =>
    notifier.markRead(ids === "all" ? "all" : Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : []),
  );
  ipcMain.handle("notification:clear", () => notifier.clearRead());
  ipcMain.handle("account:patrol", async () => {
    const result = await runLoginPatrol(true);
    return { ...result, data: store.get() };
  });
  ipcMain.handle("task:fail", async (_e, id: string, reason: string) => {
    await store.update((d) => {
      const t = d.tasks.find((x) => x.id === id);
      if (t)
        Object.assign(t, {
          status: "failed",
          message: reason || "发布失败，未填写原因",
          updatedAt: new Date().toISOString(),
        });
    });
    await pruneHistory();
    return store.get();
  });
}
const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.quit();
else
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
protocol.registerSchemesAsPrivileged([{ scheme: FP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }, tutorialPrivileges]);
app.whenReady().then(async () => {
  Menu.setApplicationMenu(process.platform === "darwin" ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]) : null);
  await sealOldLog().catch(() => undefined);
  const recovery = await store.load();
  await sealPlainFiles().catch((e) => writeBrowserLog("seal-files-failed " + String(e)));
  if (recovery.warning) console.warn(recovery.warning);
  await store.update((d) => {
    for (const t of d.tasks)
      if (["pending", "opening", "uploading", "publishing"].includes(t.status))
        Object.assign(t, {
          status: "failed",
          message: t.status === "pending" ? "上次运行被中断（应用已关闭），这一条还没开始填写。需要时可重新发布。" : "上次运行被中断（应用已关闭），未完成填写。可重新发布，或打开发布页手动处理。",
          updatedAt: new Date().toISOString(),
        });
  });
  await pruneHistory();
  await license.init();
  registerImageProtocol();
  registerTutorial();
  ipc();
  await createWindow();
  const refreshAll = async () => {
    await license.refresh();
    await license.refreshRules();
  };
  void refreshAll();
  void lookupIp();
  scheduleMpHealth(MP_HEALTH_FIRST_DELAY_MS);
  setInterval(() => void refreshAll(), LICENSE_TICK_MS);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", (event) => {
  if (quittingAfterSessionFlush || !browsers) return;
  event.preventDefault();
  quittingAfterSessionFlush = true;
  void browsers.destroy().finally(() => {
    browsers = null;
    app.quit();
  });
});
ipcMain.handle("app:dirty", (_e, dirty: unknown) => {
  composerDirty = dirty === true;
});
ipcMain.handle("app:close-confirmed", () => {
  closeConfirmed = true;
  win?.close();
});
ipcMain.handle(
  "account:selection",
  (_e, type: "video" | "image_text", accountIds: string[]) =>
    store.update((d) => {
      const valid = new Set(d.accounts.map((account) => account.id));
      d.accountSelections[type] = Array.from(
        new Set(accountIds.filter((id) => valid.has(id))),
      );
    }),
);
