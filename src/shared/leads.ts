import type { Platform } from "./types";

export type Intent = "ask" | "negative" | "spam" | "other";
export type LeadStatus = "pending" | "replied" | "ignored" | "failed";
export type MatchMode = "any" | "all" | "none" | "exact" | "always";
/** 抓取时效：只收这个时间范围内发出的评论 */
export type ScanWindow = "latest" | "1d" | "3d" | "7d" | "30d" | "all";

export interface CommentItem {
  id: string;
  platform: Platform;
  accountId: string;
  accountName: string;
  itemId: string;
  itemTitle: string;
  commentId: string;
  author: string;
  content: string;
  /** 评论发出的时间（拿不到平台时间时退回抓取时间） */
  createdAt: number;
  /** 平台上真实的评论时间。undefined = 该平台这条没识别出时间 */
  postedAt?: number;
  /** 平台原样显示的时间文本，比如「5天前」「2024-10-02」，排查用 */
  timeText?: string;
  /** 页面没给出任何时间线索，只能当新评论处理 */
  timeUnknown?: boolean;
  intent: Intent;
  status: LeadStatus;
  replyText?: string;
  repliedAt?: number;
  note?: string;
}

export interface ReplyRule {
  id: string;
  name: string;
  enabled: boolean;
  platforms: Platform[];
  /** 只对这几个账号生效（账号 id）；空 = 上面选中平台的全部账号 */
  accounts: string[];
  mode: MatchMode;
  keywords: string[];
  replies: string[];
  delaySec: number;
  dailyCap: number;
  skipNegative: boolean;
}

export interface LeadsSettings {
  rules: ReplyRule[];
  autoSend: boolean;
  perAccountGapSec: number;
  /** 批量回复换到另一个账号时，在上面那个间隔之外再多停这么多秒 */
  switchAccountGapSec: number;
  maxScanWorks: number;
  /** 抓评时间窗口，默认只收最近 3 天 */
  scanWindow: ScanWindow;
}

export const DEFAULT_LEADS_SETTINGS: LeadsSettings = {
  rules: [],
  autoSend: false,
  perAccountGapSec: 45,
  switchAccountGapSec: 60,
  maxScanWorks: 10,
  scanWindow: "3d",
};

/** 同一账号两次回复的兜底下限：设置里写多小都不让连着发，连发是最像机器人的特征 */
export const MIN_REPLY_GAP_SEC = 20;

/**
 * 批量回复两条之间该等多久。
 * 同一个号按 perAccountGapSec 节流；换到另一个号时再多停 switchAccountGapSec，
 * 因为「几个号轮着动作」比「一个号连着动作」更像多账号批量操作。
 */
export function replyGapSec(settings: LeadsSettings, sameAccount: boolean): number {
  const base = Math.max(MIN_REPLY_GAP_SEC, Math.min(settings.perAccountGapSec, 300));
  if (sameAccount) return base;
  const extra = Math.max(0, Math.min(settings.switchAccountGapSec, 600));
  return Math.min(base + extra, 900);
}

export const SCAN_WINDOW_OPTIONS: Array<{ value: ScanWindow; label: string; hint: string }> = [
  { value: "latest", label: "只抓最新一条", hint: "每个账号只留下最新那一条评论，适合盯刚发出去的作品" },
  { value: "1d", label: "最近 1 天", hint: "只收前一天到现在的评论" },
  { value: "3d", label: "最近 3 天", hint: "默认就是这一档：三天还没回，多半已经凉了" },
  { value: "7d", label: "最近 7 天", hint: "一周内的评论都收，适合不常开软件的节奏" },
  { value: "30d", label: "最近 30 天", hint: "一个月内的都收，列表会变长" },
  { value: "all", label: "不限时间", hint: "平台给什么就收什么，包括很早以前的评论" },
];

export const SCAN_WINDOW_LABEL: Record<ScanWindow, string> = {
  latest: "只抓最新一条",
  "1d": "最近 1 天",
  "3d": "最近 3 天",
  "7d": "最近 7 天",
  "30d": "最近 30 天",
  all: "不限时间",
};

export const INTENT_LABEL: Record<Intent, string> = {
  ask: "咨询",
  negative: "负评",
  other: "普通",
  spam: "灌水",
};

export const STATUS_LABEL: Record<LeadStatus, string> = {
  pending: "待回复",
  replied: "已回复",
  ignored: "已忽略",
  failed: "发送失败",
};

const NEGATIVE = [
  "骗人", "骗子", "垃圾", "退钱", "退款", "假的", "没用", "不好用", "太差", "差评", "坑", "投诉",
  "举报", "失望", "上当", "骗", "恶心", "无语", "翻车", "卡死", "闪退", "报错", "坏了", "不能用",
];

const ASK = [
  "多少钱", "价格", "怎么买", "哪里买", "链接", "求", "怎么用", "怎么弄", "怎么下载", "下载",
  "教程", "支持吗", "能用吗", "可以吗", "有吗", "有没有", "咨询", "请问", "怎么", "如何", "什么",
  "吗", "能不能", "可以", "求教", "求助",
];

const SPAM = ["互粉", "互关", "关注我", "加微信", "加v", "加V", "兼职", "刷单", "引流", "代做", "代运营"];

const hit = (text: string, words: string[]) => words.some((w) => w && text.includes(w));

export function classifyIntent(content: string): Intent {
  const text = (content || "").toLowerCase();
  if (!text.trim()) return "other";
  if (hit(text, SPAM)) return "spam";
  if (hit(text, NEGATIVE)) return "negative";
  if (hit(text, ASK) || /[?？]/.test(text)) return "ask";
  return "other";
}

export function matchRule(rule: ReplyRule, item: CommentItem): boolean {
  if (!rule.enabled) return false;
  if (rule.platforms.length && !rule.platforms.includes(item.platform)) return false;
  // 规则可以只盯某几个号：同平台多号时，福利号和专业号能各用一套话术
  if (rule.accounts?.length && !rule.accounts.includes(item.accountId)) return false;
  if (rule.skipNegative && item.intent === "negative") return false;
  const text = (item.content || "").toLowerCase();
  const words = rule.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
  switch (rule.mode) {
    case "always":
      return true;
    case "exact":
      return words.some((w) => text.trim() === w);
    case "none":
      return words.length > 0 && !words.some((w) => text.includes(w));
    case "all":
      return words.length > 0 && words.every((w) => text.includes(w));
    case "any":
    default:
      return words.length > 0 && words.some((w) => text.includes(w));
  }
}

export function firstRuleFor(rules: ReplyRule[], item: CommentItem): ReplyRule | undefined {
  return rules.find((rule) => matchRule(rule, item));
}

export function renderReply(template: string, item: CommentItem): string {
  return (template || "")
    .replace(/\{\{\s*author\s*\}\}/g, item.author || "朋友")
    .replace(/\{\{\s*platform\s*\}\}/g, item.platform)
    .replace(/\{\{\s*account\s*\}\}/g, item.accountName || "")
    .replace(/\{\{\s*content\s*\}\}/g, (item.content || "").slice(0, 40))
    .trim();
}

export function pickReply(rule: ReplyRule, turn: number): string {
  const list = rule.replies.map((r) => r.trim()).filter(Boolean);
  if (!list.length) return "";
  const index = ((turn % list.length) + list.length) % list.length;
  return list[index];
}

/* ------------------------------------------------------------------ *
 * 评论时间：把平台显示的时间文本解析成时间戳，用来做时效过滤
 * ------------------------------------------------------------------ */

const CN_DIGIT: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** 「12」「二十五」「一」这类都转成数字，最多到 99 */
function looseNumber(text: string): number | undefined {
  const s = (text || "").trim();
  if (!s) return undefined;
  if (/^\d{1,4}$/.test(s)) return Number(s);
  if (!/^[零〇一二三四五六七八九十两]{1,4}$/.test(s)) return undefined;
  let total = 0;
  let cur = 0;
  for (const ch of s) {
    if (ch === "十") {
      total += (cur || 1) * 10;
      cur = 0;
    } else {
      cur = CN_DIGIT[ch] ?? 0;
    }
  }
  return total + cur;
}

const DAY = 86400000;
const MIN_TIME = Date.UTC(2005, 0, 1);

/** 构造本地时间戳，顺手挡掉 2 月 31 日这类脏数据 */
function stamp(y: number, mo: number, d: number, h = 0, mi = 0, s = 0, now: number): number | undefined {
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return undefined;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  if (h > 23 || mi > 59 || s > 59) return undefined;
  const t = new Date(y, mo - 1, d, h, mi, s).getTime();
  if (!Number.isFinite(t)) return undefined;
  if (t < MIN_TIME || t > now + DAY) return undefined;
  return t;
}

/**
 * 解析平台上的时间文本。认得这些：
 * 刚刚 / 3分钟前 / 2小时前 / 5天前 / 一周前 / 3个月前 / 昨天 10:20 / 前天
 * 2024-10-02 / 2026年11月10日 10:33 / 11-10 10:34 / 10月30日 / 10:34
 * 13 位毫秒 / 10 位秒时间戳
 * 认不出来返回 undefined（调用方按「时间未知」处理，不会当成远古评论丢掉）
 */
export function parseCommentTime(raw: string | undefined, now = Date.now()): number | undefined {
  const flat = String(raw || "").replace(/[\u00a0\u3000]/g, " ").replace(/：/g, ":").replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  const text = flat
    .replace(/^(发表于|发布于|评论于|评论时间|时间)\s*:?\s*/, "")
    .replace(/^(edited|posted)\s*/i, "")
    .trim();
  if (!text || text.length > 40) return undefined;

  // 时间戳
  if (/^\d{13}$/.test(text)) {
    const v = Number(text);
    return v >= MIN_TIME && v <= now + DAY ? v : undefined;
  }
  if (/^\d{10}$/.test(text)) {
    const v = Number(text) * 1000;
    return v >= MIN_TIME && v <= now + DAY ? v : undefined;
  }

  // 绝对日期，带年份
  let m = text.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return stamp(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), now);

  // 相对时间
  const rel = text.match(/^(\d{1,4}|[零〇一二三四五六七八九十两]{1,4})\s*(秒|秒钟|分钟|分|小时|钟头|天|日|周|星期|个?月|年)\s*(前|以前|ago)?$/i);
  if (rel) {
    const n = looseNumber(rel[1]);
    if (n === undefined) return undefined;
    const unit = rel[2];
    const per = /秒/.test(unit)
      ? 1000
      : /分/.test(unit)
        ? 60000
        : /小时|钟头/.test(unit)
          ? 3600000
          : /周|星期/.test(unit)
            ? 7 * DAY
            : /月/.test(unit)
              ? 30 * DAY
              : /年/.test(unit)
                ? 365 * DAY
                : DAY;
    const t = now - n * per;
    return t >= MIN_TIME ? t : undefined;
  }

  // 今天 / 昨天 / 前天（可带时刻）
  const dayWord = text.match(/^(今天|今日|昨天|昨日|前天)(?:\s*(\d{1,2}):(\d{1,2}))?/);
  if (dayWord) {
    const back = dayWord[1] === "前天" ? 2 : /昨/.test(dayWord[1]) ? 1 : 0;
    const base = new Date(now);
    base.setDate(base.getDate() - back);
    return stamp(base.getFullYear(), base.getMonth() + 1, base.getDate(), +(dayWord[2] || 0), +(dayWord[3] || 0), 0, now);
  }

  if (/^(刚刚|刚才|just now|now)$/i.test(text)) return now;

  // 不带年份的月-日（有的平台跨年只显示月日，晚于今天就按去年算）
  m = text.match(/^(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?(?:\s*(\d{1,2}):(\d{2}))?/);
  if (m) {
    const mo = +m[1];
    const d = +m[2];
    const y = new Date(now).getFullYear();
    const thisYear = stamp(y, mo, d, +(m[3] || 0), +(m[4] || 0), 0, now + DAY);
    if (thisYear !== undefined && thisYear <= now + DAY) return thisYear;
    return stamp(y - 1, mo, d, +(m[3] || 0), +(m[4] || 0), 0, now);
  }

  // 只有时刻（今天的，晚于当前时间就按昨天算）
  m = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const h = +m[1];
    const mi = +m[2];
    const s = +(m[3] || 0);
    const today = new Date(now);
    const t = stamp(today.getFullYear(), today.getMonth() + 1, today.getDate(), h, mi, s, now + 2 * 60000);
    if (t !== undefined && t <= now + 2 * 60000) return t;
    const y = new Date(now - DAY);
    return stamp(y.getFullYear(), y.getMonth() + 1, y.getDate(), h, mi, s, now);
  }

  return undefined;
}

/** 窗口对应的最早时间；undefined = 不限 */
export function windowCutoff(w: ScanWindow, now = Date.now()): number | undefined {
  switch (w) {
    case "1d":
      return now - DAY;
    case "7d":
      return now - 7 * DAY;
    case "30d":
      return now - 30 * DAY;
    case "all":
      return undefined;
    case "latest":
    case "3d":
    default:
      // 「只抓最新一条」也要有时效底线：最新一条都超过三天了，这个号就是没新评论
      return now - 3 * DAY;
  }
}

export interface WindowFilterResult {
  kept: CommentItem[];
  /** 因为超出时间范围被挡掉的数量 */
  skipped: number;
  /** 平台没给时间、只能保守收下的数量 */
  unknown: number;
  /** 整页一条时间都没识别出来，本次没按时间过滤 */
  unfiltered: boolean;
}

/**
 * 按时效收评论。整页都拿不到时间时不做过滤——宁可多收，也不能因为没适配就把评论全丢了。
 */
export function applyScanWindow(items: CommentItem[], w: ScanWindow, now = Date.now()): WindowFilterResult {
  if (!items.length) return { kept: [], skipped: 0, unknown: 0, unfiltered: false };
  if (w === "all") return { kept: items, skipped: 0, unknown: 0, unfiltered: false };

  const known = items.filter((i) => !i.timeUnknown && typeof i.postedAt === "number" && i.postedAt > 0);
  if (!known.length) return { kept: items, skipped: 0, unknown: items.length, unfiltered: true };

  const cutoff = windowCutoff(w, now) ?? 0;
  if (w === "latest") {
    const fresh = known.filter((i) => (i.postedAt as number) >= cutoff).sort((a, b) => (b.postedAt as number) - (a.postedAt as number));
    const best = fresh[0];
    return {
      kept: best ? [best] : [],
      skipped: items.length - (best ? 1 : 0),
      unknown: items.length - known.length,
      unfiltered: false,
    };
  }

  const kept = items.filter((i) => i.timeUnknown || typeof i.postedAt !== "number" || i.postedAt >= cutoff);
  return { kept, skipped: items.length - kept.length, unknown: items.length - known.length, unfiltered: false };
}

/** 已经入库的评论是否超出当前时效（界面上标出来，不删数据） */
export function isStale(item: CommentItem, w: ScanWindow, now = Date.now()): boolean {
  const cutoff = windowCutoff(w, now);
  if (cutoff === undefined) return false;
  if (item.timeUnknown || typeof item.postedAt !== "number") return false;
  return item.postedAt < cutoff;
}

export interface ReplyBudget {
  /** 这个账号今天一共回了几条（不分规则），用于展示 */
  repliesToday: number;
  lastReplyAt: number;
  /** 这个账号在这条规则下今天回了几条；不传则退回总量（老调用方的兜底） */
  ruleRepliesToday?: number;
}

/** 日上限按「账号 + 规则」分账，key 就是这个格式 */
export function ruleBudgetKey(accountId: string, ruleId: string) {
  return accountId + "@" + ruleId;
}

export function replyBlockedReason(
  rule: ReplyRule,
  budget: ReplyBudget,
  now: number,
  gapSec: number,
): string | undefined {
  // 上限必须是「这个号在这条规则下」的累计数。拿账号总回复数来比会把别的规则的配额算进来，
  // 结果是先跑的规则把后跑的规则堵死（或者反过来放行到超量）。
  const usedByRule = typeof budget.ruleRepliesToday === "number" ? budget.ruleRepliesToday : budget.repliesToday;
  if (rule.dailyCap > 0 && usedByRule >= rule.dailyCap) return "这条规则今天在这个账号已经到上限（" + rule.dailyCap + " 条）";
  if (budget.lastReplyAt > 0 && now - budget.lastReplyAt < gapSec * 1000) {
    const wait = Math.ceil((gapSec * 1000 - (now - budget.lastReplyAt)) / 1000);
    return "离上一条回复太近，还要等 " + wait + " 秒";
  }
  return undefined;
}

const rank: Record<Intent, number> = { ask: 0, negative: 1, other: 2, spam: 3 };

export function sortQueue(items: CommentItem[]): CommentItem[] {
  return [...items].sort((a, b) => {
    if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
    const r = rank[a.intent] - rank[b.intent];
    if (r !== 0) return r;
    return (b.postedAt ?? b.createdAt) - (a.postedAt ?? a.createdAt);
  });
}

/**
 * 批量回复的执行顺序：一个账号连着做完再换下一个号。
 * 混着发会在多个账号窗口之间来回切，比单个号连发更像机器行为。
 */
export function groupByAccount(items: CommentItem[]): CommentItem[][] {
  const order: string[] = [];
  const groups = new Map<string, CommentItem[]>();
  for (const item of items) {
    const key = item.accountId || item.platform;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
      order.push(key);
    }
    bucket.push(item);
  }
  return order.map((key) => groups.get(key) as CommentItem[]);
}

export function mergeComments(existing: CommentItem[], incoming: CommentItem[], keep = 600) {
  const map = new Map(existing.map((x) => [x.id, x]));
  let added = 0;
  for (const item of incoming) {
    const old = map.get(item.id);
    if (!old) {
      map.set(item.id, item);
      added += 1;
      continue;
    }
    // 已处理过的状态不能被抓取覆盖，只更新内容；时间在这一轮抓到了就补上
    map.set(item.id, {
      ...old,
      content: item.content,
      author: item.author,
      itemTitle: item.itemTitle || old.itemTitle,
      postedAt: item.postedAt ?? old.postedAt,
      timeText: item.timeText || old.timeText,
      timeUnknown: item.postedAt ? false : old.timeUnknown,
      createdAt: item.postedAt ?? old.createdAt,
    });
  }
  const list = [...map.values()].sort((a, b) => (b.postedAt ?? b.createdAt) - (a.postedAt ?? a.createdAt)).slice(0, keep);
  return { list, added };
}

export function commentKey(platform: string, accountId: string, commentId: string) {
  return platform + ":" + accountId + ":" + commentId;
}

export function leadsStats(items: CommentItem[]) {
  const pending = items.filter((i) => i.status === "pending");
  return {
    total: items.length,
    pending: pending.length,
    ask: pending.filter((i) => i.intent === "ask").length,
    negative: pending.filter((i) => i.intent === "negative").length,
    replied: items.filter((i) => i.status === "replied").length,
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const text = (v: unknown, fallback = "") => (typeof v === "string" ? v.trim() : fallback);
const num = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

const MODES: MatchMode[] = ["any", "all", "none", "exact", "always"];
const WINDOWS: ScanWindow[] = ["latest", "1d", "3d", "7d", "30d", "all"];

export function normalizeRule(raw: unknown, index: number): ReplyRule | undefined {
  if (!isRecord(raw)) return undefined;
  const replies = Array.isArray(raw.replies) ? raw.replies.map((r) => text(r)).filter(Boolean) : [];
  if (!replies.length) return undefined;
  const platforms = Array.isArray(raw.platforms) ? raw.platforms.map((p) => text(p)).filter(Boolean) : [];
  return {
    id: text(raw.id) || "r" + index,
    name: text(raw.name) || "规则 " + (index + 1),
    enabled: raw.enabled !== false,
    platforms: platforms as Platform[],
    accounts: Array.isArray(raw.accounts) ? raw.accounts.map((a) => text(a)).filter(Boolean) : [],
    mode: MODES.includes(raw.mode as MatchMode) ? (raw.mode as MatchMode) : "any",
    keywords: Array.isArray(raw.keywords) ? raw.keywords.map((k) => text(k)).filter(Boolean) : [],
    replies,
    delaySec: num(raw.delaySec, 0, 0, 3600),
    dailyCap: num(raw.dailyCap, 50, 0, 500),
    skipNegative: raw.skipNegative !== false,
  };
}

export function normalizeLeadsSettings(raw: unknown): LeadsSettings {
  if (!isRecord(raw)) return { ...DEFAULT_LEADS_SETTINGS };
  const rules = (Array.isArray(raw.rules) ? raw.rules : [])
    .map((r, i) => normalizeRule(r, i))
    .filter((r): r is ReplyRule => Boolean(r));
  return {
    rules,
    autoSend: raw.autoSend === true,
    perAccountGapSec: num(raw.perAccountGapSec, DEFAULT_LEADS_SETTINGS.perAccountGapSec, 0, 600),
    switchAccountGapSec: num(raw.switchAccountGapSec, DEFAULT_LEADS_SETTINGS.switchAccountGapSec, 0, 600),
    maxScanWorks: num(raw.maxScanWorks, DEFAULT_LEADS_SETTINGS.maxScanWorks, 1, 30),
    scanWindow: WINDOWS.includes(raw.scanWindow as ScanWindow) ? (raw.scanWindow as ScanWindow) : DEFAULT_LEADS_SETTINGS.scanWindow,
  };
}

export interface LeadsScanSummary {
  scanned: number;
  accounts: number;
  added: number;
  /** 按时间范围挡掉的条数 */
  skipped?: number;
  /** 页面没给时间、只能收下的条数 */
  unknownTime?: number;
  /** 完全没识别到时间的账号，这次没按时间过滤 */
  unfiltered?: string[];
  window?: ScanWindow;
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

export interface LeadsStats {
  total: number;
  pending: number;
  ask: number;
  negative: number;
  replied: number;
}

export interface LeadsAccountRef {
  id: string;
  name: string;
  platform: Platform;
  /** 账号当前是否在线；离线的历史线索还在，但发不出去 */
  online: boolean;
}

export interface LeadsView {
  settings: LeadsSettings;
  comments: CommentItem[];
  stats: LeadsStats;
  scanAt: number;
  platforms: Platform[];
  available: Platform[];
  /** 界面上按账号筛选用：带上账号名，才能分清同平台的两个号 */
  accounts: LeadsAccountRef[];
}
