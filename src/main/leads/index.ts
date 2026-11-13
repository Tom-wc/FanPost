import { app, ipcMain, type BrowserWindow, type WebContents } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Account, Platform } from "../../shared/types";
import {
  applyScanWindow,
  classifyIntent,
  commentKey,
  groupByAccount,
  leadsStats,
  mergeComments,
  normalizeLeadsSettings,
  parseCommentTime,
  renderReply,
  firstRuleFor,
  pickReply,
  replyBlockedReason,
  replyGapSec,
  ruleBudgetKey,
  sortQueue,
  DEFAULT_LEADS_SETTINGS,
  type CommentItem,
  type Intent,
  type LeadsSettings,
} from "../../shared/leads";
import type { BrowserManager } from "../browser-manager";
import { EXTRACT_SCRIPT, fillScript, COMMENT_PAGES, PROBE_SCRIPT, SCANNABLE } from "./platforms";

const FILE = () => path.join(app.getPath("userData"), "leads.json");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Budget {
  date: string;
  replies: number;
  lastReplyAt: number;
}

interface RuleBudget {
  date: string;
  replies: number;
}

interface LeadsFile {
  settings: LeadsSettings;
  comments: CommentItem[];
  /** 按账号记：总回复数 + 最后一次时间（节流用） */
  budgets: Record<string, Budget>;
  /** 按「账号@规则」记：这条规则今天在这个号上用掉多少额度 */
  ruleBudgets: Record<string, RuleBudget>;
  scanAt: number;
}

let cache: LeadsFile | undefined;

const today = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
};

async function load(): Promise<LeadsFile> {
  if (cache) return cache;
  const raw = await fs.readFile(FILE(), "utf8").catch(() => "");
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : undefined;
  } catch {
    parsed = undefined;
  }
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  cache = {
    settings: normalizeLeadsSettings(obj.settings),
    comments: Array.isArray(obj.comments) ? (obj.comments as CommentItem[]).filter((c) => c && c.id) : [],
    budgets: (obj.budgets && typeof obj.budgets === "object" ? obj.budgets : {}) as Record<string, Budget>,
    // 老数据没有这个字段，读出来是空表，配额从今天重新记，不会误挡
    ruleBudgets: (obj.ruleBudgets && typeof obj.ruleBudgets === "object" ? obj.ruleBudgets : {}) as Record<string, RuleBudget>,
    scanAt: typeof obj.scanAt === "number" ? obj.scanAt : 0,
  };
  return cache;
}

async function save(next: LeadsFile) {
  cache = next;
  await fs.mkdir(path.dirname(FILE()), { recursive: true });
  await fs.writeFile(FILE(), JSON.stringify(next), "utf8");
}

function hash(input: string) {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

interface RawItem {
  author: string;
  content: string;
  itemTitle: string;
  /** 平台上显示的时间文本，比如「5天前」「2024-10-02」 */
  time?: string;
}

function toItems(account: Account, raw: RawItem[], now = Date.now()): CommentItem[] {
  const out: CommentItem[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const content = (r.content || "").trim();
    if (!content) continue;
    // 转发链（//@xxx: ...）不是评论，回过去等于在别人的转发下留言，直接跳过
    if (/^\/\/@/.test(content)) continue;
    const author = (r.author || "").trim();
    const commentId = hash(author + "|" + content);
    const id = commentKey(account.platform, account.id, commentId);
    if (seen.has(id)) continue;
    seen.add(id);
    const timeText = (r.time || "").replace(/\s+/g, " ").trim().slice(0, 24);
    const postedAt = timeText ? parseCommentTime(timeText, now) : undefined;
    out.push({
      id,
      platform: account.platform,
      accountId: account.id,
      accountName: account.name || account.id,
      itemId: "",
      itemTitle: r.itemTitle || "",
      commentId,
      author: author || "（未识别）",
      content,
      // 拿不到平台时间就退回抓取时间，界面上会标成「时间未知」
      createdAt: postedAt ?? now,
      postedAt,
      timeText: timeText || undefined,
      timeUnknown: postedAt === undefined,
      intent: classifyIntent(content) as Intent,
      status: "pending",
    });
  }
  return out;
}

export interface ScanSummary {
  scanned: number;
  accounts: number;
  added: number;
  /** 按时间范围挡掉的条数 */
  skipped: number;
  /** 平台页面没给出时间、只能收下的条数 */
  unknownTime: number;
  /** 平台一条时间都识别不到，这次没按时间过滤 */
  unfiltered: string[];
  window: LeadsSettings["scanWindow"];
  platforms: Array<{
    platform: Platform;
    account: string;
    ok: boolean;
    found: number;
    kept?: number;
    skipped?: number;
    unknownTime?: number;
    buttons?: number;
    url?: string;
    error?: string;
  }>;
}

let scanning = false;
let replying = false;
const replyingAccounts = new Set<string>();

export function registerLeads(deps: {
  getWindow: () => BrowserWindow | undefined;
  getData: () => { accounts: Account[] };
  browsers: () => BrowserManager | undefined;
  assertLicensed: () => void;
}) {
  const view = async () => {
    const file = await load();
    const accounts = deps.getData().accounts;
    return {
      settings: file.settings,
      comments: sortQueue(file.comments),
      stats: leadsStats(file.comments),
      scanAt: file.scanAt,
      platforms: SCANNABLE,
      available: SCANNABLE.filter((p) => accounts.some((a) => a.platform === p && a.loginStatus === "logged_in")),
      // 同平台多号是常态，界面按账号筛选要靠这份清单
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name || a.remark || a.id,
        platform: a.platform,
        online: a.loginStatus === "logged_in",
      })),
    };
  };

  // 开发版跳过授权门禁：本地 mock 授权常处于「已吊销 / 已过期」状态用来测降级，没必要卡住功能联调。
  const assertLicensed = () => {
    if (!app.isPackaged) return;
    deps.assertLicensed();
  };

  ipcMain.handle("leads:get", () => view());

  /** 平台改版自检：打开某个平台的评论页，把结构摊开。只在开发版可用。 */
  ipcMain.handle("leads:probe", async (_e, raw: unknown) => {
    if (app.isPackaged) throw new Error("仅开发版可用");
    // 开发用：既支持传平台名（走内置评论页），也支持 { platform, url } 临时探任意页面
    const input = (raw && typeof raw === "object" ? raw : { platform: raw }) as { platform?: Platform; url?: string; script?: string; waitMs?: number; visible?: boolean };
    const platform = input.platform as Platform;
    const cfg = COMMENT_PAGES[platform];
    const url = input.url || cfg?.listUrl;
    if (!url) return { ok: false, error: "这个平台还没接入评论页" };
    const browsers = deps.browsers();
    if (!browsers) return { ok: false, error: "浏览器还没就绪" };
    const account = deps.getData().accounts.find((a) => a.platform === platform && a.loginStatus === "logged_in");
    if (!account) return { ok: false, error: "没有在线账号" };
    const run = async (wc: WebContents) => {
      await wc.loadURL(url).catch(() => undefined);
      await wait(Math.max(2000, Math.min(input.waitMs ?? 6000, 20000)));
      return (await wc.executeJavaScript(input.script || PROBE_SCRIPT, true).catch((e) => JSON.stringify({ error: String(e) }))) as string;
    };
    const json = input.visible
      ? await browsers.withAccountPage(account, undefined, run)
      : await browsers.withHiddenPage(account, run);
    let probe: unknown;
    try {
      probe = JSON.parse(json);
    } catch {
      probe = { raw: json };
    }
    return { ok: true, account: account.name || account.id, platform, probe };
  });

  ipcMain.handle("leads:save-settings", async (_e, raw: unknown) => {
    const file = await load();
    const settings = normalizeLeadsSettings(raw);
    await save({ ...file, settings });
    return { settings };
  });

  ipcMain.handle("leads:scan", async (_e, raw: unknown) => {
    assertLicensed();
    if (scanning) return { ok: false, error: "上一次抓取还没结束，稍等一下" };
    const browsers = deps.browsers();
    if (!browsers) return { ok: false, error: "浏览器还没就绪" };
    // 老调用方传 Platform[]，新调用方传 { platforms, accountIds }
    const input = Array.isArray(raw)
      ? { platforms: raw as Platform[] }
      : ((raw || {}) as { platforms?: Platform[]; accountIds?: string[] });
    const picked = Array.isArray(input.platforms) && input.platforms.length
      ? input.platforms.filter((p) => SCANNABLE.includes(p))
      : SCANNABLE;
    const onlyAccounts = Array.isArray(input.accountIds) && input.accountIds.length ? new Set(input.accountIds) : undefined;
    const accounts = deps.getData().accounts.filter(
      (a) => picked.includes(a.platform) && a.loginStatus === "logged_in" && (!onlyAccounts || onlyAccounts.has(a.id)),
    );
    if (!accounts.length) return { ok: false, error: "这些账号没有在线，先在「账号」页扫码登录" };
    scanning = true;
    const summary: ScanSummary = { scanned: 0, accounts: accounts.length, added: 0, skipped: 0, unknownTime: 0, unfiltered: [], window: "3d", platforms: [] };
    try {
      const file = await load();
      const win = file.settings.scanWindow;
      summary.window = win;
      let list = file.comments;
      const incoming: CommentItem[] = [];
      for (const account of accounts) {
        const cfg = COMMENT_PAGES[account.platform];
        if (!cfg) continue;
        let found = 0;
        try {
          const script = cfg.extract || EXTRACT_SCRIPT;
          const json = await browsers.withHiddenPage(account, async (wc) => {
            await wc.loadURL(cfg.listUrl).catch(() => undefined);
            await wait(cfg.waitMs || 4000);
            return (await wc.executeJavaScript(script, true).catch(() => "")) as string;
          });
          const parsed = typeof json === "string" && json
            ? (JSON.parse(json) as { items?: RawItem[]; replyButtons?: number; url?: string })
            : { items: [] };
          const landed = String(parsed.url || "");
          if (/\/(login|passport|sso)\b|login\./i.test(landed)) {
            summary.platforms.push({
              platform: account.platform,
              account: account.name || account.id,
              ok: false,
              found: 0,
              buttons: parsed.replyButtons || 0,
              url: landed.replace(/^https?:\/\/[^/]+/, ""),
              error: "跳到了登录页，这个账号可能掉线了",
            });
            continue;
          }
          const items = toItems(account, parsed.items || []);
          found = items.length;
          // 时效过滤：平台页面上的时间可能是一年前的，按设置的时间范围挡掉
          const filtered = applyScanWindow(items, win);
          if (filtered.unfiltered) summary.unfiltered.push(account.name || account.id);
          summary.skipped += filtered.skipped;
          summary.unknownTime += filtered.unknown;
          incoming.push(...filtered.kept);
          const merged = mergeComments(list, filtered.kept);
          list = merged.list;
          summary.added += merged.added;
          summary.scanned += items.length;
          summary.platforms.push({
            platform: account.platform,
            account: account.name || account.id,
            ok: true,
            found,
            kept: filtered.kept.length,
            skipped: filtered.skipped,
            unknownTime: filtered.unknown,
            buttons: parsed.replyButtons || 0,
            url: landed.replace(/^https?:\/\/[^/]+/, ""),
          });
        } catch (error) {
          summary.platforms.push({
            platform: account.platform,
            account: account.name || account.id,
            ok: false,
            found: 0,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      // 抓取期间用户可能改了设置（比如切换时间范围），落盘时以最新的设置为准，
      // 只覆盖评论本身，别把这次扫描开始前的快照写回去
      const latest = await load();
      await save({ ...latest, comments: mergeComments(latest.comments, incoming).list, scanAt: Date.now() });
      deps.getWindow()?.webContents.send("leads:changed");
      return { ok: true, summary };
    } finally {
      scanning = false;
    }
  });

  /** 单条回复：定位评论 → 填入 → 可选点发送，结果落盘。批量回复也走这里。 */
  const replyOne = async (raw: unknown): Promise<{ ok: boolean; sent?: boolean; hint?: string; error?: string; sendButton?: string }> => {
    assertLicensed();
    const input = (raw || {}) as { id?: string; text?: string; send?: boolean };
    const file = await load();
    const item = file.comments.find((c) => c.id === input.id);
    if (!item) return { ok: false, error: "这条评论已经不在了，重新抓取一次" };
    const account = deps.getData().accounts.find((a) => a.id === item.accountId);
    if (!account) return { ok: false, error: "账号已被删除，无法回复" };
    const browsers = deps.browsers();
    if (!browsers) return { ok: false, error: "浏览器还没就绪" };
    const cfg = COMMENT_PAGES[item.platform];
    if (!cfg) return { ok: false, error: "这个平台还没接入" };

    const rule = firstRuleFor(file.settings.rules, item);
    const budget = file.budgets[account.id] && file.budgets[account.id].date === today()
      ? file.budgets[account.id]
      : { date: today(), replies: 0, lastReplyAt: 0 };
    // 日上限按「账号 + 规则」分账；节流仍看账号级的上一次时间
    const ruleKey = rule ? ruleBudgetKey(account.id, rule.id) : "";
    const ruleBudget = ruleKey && file.ruleBudgets[ruleKey] && file.ruleBudgets[ruleKey].date === today()
      ? file.ruleBudgets[ruleKey]
      : { date: today(), replies: 0 };
    const now = Date.now();
    if (rule) {
      const blocked = replyBlockedReason(
        rule,
        { repliesToday: budget.replies, lastReplyAt: budget.lastReplyAt, ruleRepliesToday: ruleBudget.replies },
        now,
        replyGapSec(file.settings, true),
      );
      if (blocked) return { ok: false, error: blocked };
    }

    const text = String(input.text || (rule ? renderReply(pickReply(rule, budget.replies), item) : "")).trim();
    if (!text) return { ok: false, error: "没有可发送的内容，先写一句或加一条规则" };
    const clipped = cfg.replyMax ? Array.from(text).slice(0, cfg.replyMax).join("") : text;
    const send = input.send === true && file.settings.autoSend;

    // 先导航到评论页再亮窗口：反过来会先把账号页带回到首页，把目标页顶掉（小红书必现）
    await browsers.withAccountPage(account, undefined, async (wc) => {
      if (!String(wc.getURL()).startsWith(cfg.listUrl)) await wc.loadURL(cfg.listUrl).catch(() => undefined);
      await wait(cfg.waitMs || 3500);
    });
    await browsers.show(account, "reveal");
    try {
      const path = cfg.listUrl.replace(/^https?:\/\/[^/]+/, "");
      const located = await browsers.withAccountPage(account, undefined, async (wc) => {
        let seen = { index: -1, url: wc.getURL(), count: 0 };
        // 平台页面渲染有快有慢（小红书要等通知流刷出来），轮询几次再判定找不到
        for (let attempt = 0; attempt < 5; attempt++) {
          if (!String(wc.getURL()).includes(path.split("?")[0])) {
            await wc.loadURL(cfg.listUrl).catch(() => undefined);
            await wait(2500);
          }
          const json = (await wc.executeJavaScript(cfg.extract || EXTRACT_SCRIPT, true).catch(() => "")) as string;
          const parsed = typeof json === "string" && json ? (JSON.parse(json) as { items?: RawItem[]; url?: string }) : { items: [] };
          const list = parsed.items || [];
          const target = item.content.slice(0, 40);
          const found = list.findIndex((r) => (r.content || "").includes(target));
          seen = { index: found, url: String(parsed.url || wc.getURL()), count: list.length };
          if (found >= 0) return seen;
          await wait(2500);
        }
        return seen;
      });
      const index = located.index;
      if (index < 0) {
        return {
          ok: false,
          error:
            "页面里没定位到这条评论（当前页 " + located.url.replace(/^https?:\/\/[^/]+/, "") + "，抓到 " + located.count + " 条），可能已刷新或需要翻页",
        };
      }
      const result = (await browsers.withAccountPage(account, undefined, (wc) =>
        wc.executeJavaScript(fillScript(index, clipped, send, cfg.replySel), true),
      )) as string;
      const parsed = JSON.parse(result || "{}") as { ok?: boolean; sent?: boolean; error?: string; sendButton?: string; verify?: string; status?: number; message?: string };
      if (!parsed.ok) return { ok: false, error: parsed.error || "填入失败" };
      const replied = parsed.sent === true;
      const rejected = !replied && !!parsed.message;
      // 回复过程有几十秒，期间可能刚抓了新评论，落盘时按最新数据合并
      const latest = await load();
      const comments = latest.comments.map((c) =>
        c.id === item.id
          ? { ...c, status: (replied ? "replied" : "pending") as CommentItem["status"], replyText: clipped, repliedAt: replied ? Date.now() : c.repliedAt }
          : c,
      );
      const prevAccount = latest.budgets[account.id];
      const accountUsed = prevAccount && prevAccount.date === today() ? prevAccount.replies : 0;
      const budgets = rejected
        ? latest.budgets
        : { ...latest.budgets, [account.id]: { date: today(), replies: accountUsed + 1, lastReplyAt: Date.now() } };
      const prevRule = ruleKey ? latest.ruleBudgets[ruleKey] : undefined;
      const ruleBudgets = ruleKey && !rejected
        ? { ...latest.ruleBudgets, [ruleKey]: { date: today(), replies: prevRule && prevRule.date === today() ? prevRule.replies + 1 : 1 } }
        : latest.ruleBudgets;
      await save({ ...latest, comments, budgets, ruleBudgets });
      deps.getWindow()?.webContents.send("leads:changed");
      return {
        ok: true,
        sent: replied,
        sendButton: parsed.sendButton,
        hint: replied
          ? "已发送，平台接口已确认"
          : rejected
            ? "平台没接受这条回复：" + parsed.message
            : parsed.verify === "api" && parsed.status
              ? "接口返回 " + parsed.status + "，可能没发出去，到账号窗口看一眼"
              : parsed.sendButton
                ? "已填进输入框但没确认发出，到账号窗口点「" + parsed.sendButton + "」"
                : "已填进输入框，到账号窗口里确认后手动点发送",
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const replyOneLocked = async (raw: unknown) => {
    const id = String(((raw || {}) as { id?: unknown }).id || "");
    const accountId = (await load()).comments.find((c) => c.id === id)?.accountId || "";
    if (accountId && replyingAccounts.has(accountId)) return { ok: false, error: "这个账号正在回复上一条，等它完成再试" };
    if (accountId) replyingAccounts.add(accountId);
    try {
      return await replyOne(raw);
    } finally {
      if (accountId) replyingAccounts.delete(accountId);
    }
  };

  ipcMain.handle("leads:reply", (_e, raw: unknown) => replyOneLocked(raw));

  /**
   * 批量回复：只处理「命中规则」的待回复评论，逐条走真实页面。
   * 负评按规则跳过，账号间按设置里的间隔节流，避免同一个号连续动作被识别成机器。
   */
  ipcMain.handle("leads:reply-all", async (_e, raw: unknown) => {
    assertLicensed();
    if (replying) return { ok: false, error: "上一批还在回复，等它跑完再开" };
    const file = await load();
    if (!file.settings.autoSend) return { ok: false, error: "批量回复会真的发出去，需要先打开「自动发送」" };
    const input = Array.isArray(raw) ? { platforms: raw as Platform[] } : ((raw || {}) as { platforms?: Platform[]; ids?: string[] });
    const only = Array.isArray(input.platforms) && input.platforms.length ? input.platforms : undefined;
    // 只发用户勾选的那几条，不做「全表扫一遍全发」
    const wanted = Array.isArray(input.ids) && input.ids.length ? new Set(input.ids) : undefined;
    if (!wanted) return { ok: false, error: "没有勾选要回复的评论", total: 0 };
    const queue = sortQueue(file.comments).filter((c) => c.status === "pending" && wanted.has(c.id) && (!only || only.includes(c.platform)));
    const targets = queue.filter((c) => {
      const rule = firstRuleFor(file.settings.rules, c);
      return !!rule && !(rule.skipNegative && c.intent === "negative");
    });
    if (!targets.length) return { ok: false, error: "勾选的这些没有命中回复规则", total: 0 };
    // 先按账号分组再串起来：一个号连着回完再换下一个号。混着发要在几个账号窗口之间来回切，
    // 反而更像机器行为，出了问题也定位不到是哪个号。
    const ordered = groupByAccount(targets).flat();

    replying = true;
    const results: Array<{ platform: Platform; account: string; author: string; ok: boolean; sent: boolean; error?: string }> = [];
    try {
      for (let i = 0; i < ordered.length; i++) {
        const item = ordered[i];
        deps.getWindow()?.webContents.send("leads:progress", { done: i, total: ordered.length, platform: item.platform, author: item.author });
        const res = await replyOneLocked({ id: item.id, send: true });
        results.push({ platform: item.platform, account: item.accountName, author: item.author, ok: res.ok, sent: res.sent === true, error: res.error });
        if (i < ordered.length - 1) {
          // 同一个号按「两条之间停多久」节流；换号再多停一会儿，几个号轮着动作更像批量操作
          const gap = replyGapSec(file.settings, ordered[i + 1].accountId === item.accountId);
          if (gap) await wait(gap * 1000);
        }
      }
      deps.getWindow()?.webContents.send("leads:progress", { done: ordered.length, total: ordered.length, finished: true });
      return { ok: true, total: ordered.length, sent: results.filter((r) => r.sent).length, results };
    } finally {
      replying = false;
    }
  });

  // 单个或批量忽略：超期评论一次清掉时不用 N 次 IPC、N 次写盘
  ipcMain.handle("leads:ignore", async (_e, raw: unknown) => {
    const ids = new Set((Array.isArray(raw) ? raw : [raw]).filter((x): x is string => typeof x === "string" && !!x));
    if (!ids.size) return { ok: true, ignored: 0 };
    const file = await load();
    let ignored = 0;
    const comments = file.comments.map((c) => {
      if (!ids.has(c.id) || c.status === "ignored") return c;
      ignored += 1;
      return { ...c, status: "ignored" as const };
    });
    if (ignored) await save({ ...file, comments });
    deps.getWindow()?.webContents.send("leads:changed");
    return { ok: true, ignored };
  });

  ipcMain.handle("leads:clear", async (_e, status: unknown) => {
    const file = await load();
    const keep = typeof status === "string" ? file.comments.filter((c) => c.status !== status) : [];
    await save({ ...file, comments: keep });
    deps.getWindow()?.webContents.send("leads:changed");
    return { removed: file.comments.length - keep.length };
  });
}

export async function resetLeadsCache() {
  cache = undefined;
}

export const LEADS_DEFAULTS = DEFAULT_LEADS_SETTINGS;
