import assert from "node:assert/strict";
import test from "node:test";
import {
  applyScanWindow,
  classifyIntent,
  commentKey,
  firstRuleFor,
  groupByAccount,
  isStale,
  leadsStats,
  matchRule,
  mergeComments,
  normalizeLeadsSettings,
  parseCommentTime,
  pickReply,
  renderReply,
  replyBlockedReason,
  replyGapSec,
  sortQueue,
  windowCutoff,
  type CommentItem,
  type ReplyRule,
} from "./leads.ts";

const item = (over: Partial<CommentItem> = {}): CommentItem => ({
  id: "douyin:a1:c1",
  platform: "douyin",
  accountId: "a1",
  accountName: "Jackie",
  itemId: "",
  itemTitle: "发票打印",
  commentId: "c1",
  author: "小王",
  content: "这个多少钱？",
  createdAt: 1,
  intent: "ask",
  status: "pending",
  ...over,
});

const rule = (over: Partial<ReplyRule> = {}): ReplyRule => ({
  id: "r1",
  name: "问价格",
  enabled: true,
  platforms: [],
  accounts: [],
  mode: "any",
  keywords: ["多少钱", "价格"],
  replies: ["看主页简介", "私信我发你"],
  delaySec: 0,
  dailyCap: 10,
  skipNegative: true,
  ...over,
});

test("评论意图能分开咨询、负评、灌水", () => {
  assert.equal(classifyIntent("这个多少钱？"), "ask");
  assert.equal(classifyIntent("能用在 mac 上吗"), "ask");
  assert.equal(classifyIntent("骗人的吧"), "negative");
  assert.equal(classifyIntent("互粉互关"), "spam");
  assert.equal(classifyIntent("拍得真好看"), "other");
  assert.equal(classifyIntent(""), "other");
});

test("关键词匹配支持任一、全部、排除、完全等于和每条都回", () => {
  const it = item({ content: "发票打印多少钱一套" });
  assert.equal(matchRule(rule({ mode: "any", keywords: ["多少钱", "价格"] }), it), true);
  assert.equal(matchRule(rule({ mode: "all", keywords: ["多少钱", "价格"] }), it), false);
  assert.equal(matchRule(rule({ mode: "all", keywords: ["发票", "多少钱"] }), it), true);
  assert.equal(matchRule(rule({ mode: "none", keywords: ["退款"] }), it), true);
  assert.equal(matchRule(rule({ mode: "none", keywords: ["发票"] }), it), false);
  assert.equal(matchRule(rule({ mode: "exact", keywords: ["发票打印多少钱一套"] }), it), true);
  assert.equal(matchRule(rule({ mode: "exact", keywords: ["多少钱"] }), it), false);
  assert.equal(matchRule(rule({ mode: "always", keywords: [] }), it), true);
});

test("规则会按平台过滤，负评默认不自动回，关掉的规则不参与", () => {
  const it = item({ platform: "bilibili" });
  assert.equal(matchRule(rule({ platforms: ["douyin"] }), it), false);
  assert.equal(matchRule(rule({ platforms: ["bilibili"] }), it), true);
  assert.equal(matchRule(rule({ platforms: [] }), it), true);
  assert.equal(matchRule(rule({ enabled: false }), it), false);
  const bad = item({ intent: "negative", content: "骗人多少钱" });
  assert.equal(matchRule(rule(), bad), false);
  assert.equal(matchRule(rule({ skipNegative: false }), bad), true);
});

test("命中顺序按规则表从上往下取第一条", () => {
  const rules = [rule({ id: "a", platforms: ["bilibili"] }), rule({ id: "b" })];
  assert.equal(firstRuleFor(rules, item())?.id, "b");
  assert.equal(firstRuleFor([], item()), undefined);
});

test("话术轮换和作者变量替换", () => {
  const r = rule();
  assert.equal(pickReply(r, 0), "看主页简介");
  assert.equal(pickReply(r, 1), "私信我发你");
  assert.equal(pickReply(r, 3), "私信我发你");
  assert.equal(pickReply(rule({ replies: [] }), 0), "");
  assert.equal(renderReply("{{author}} 看主页简介", item({ author: "小李" })), "小李 看主页简介");
  assert.equal(renderReply("{{ author }}好", item()), "小王好");
  assert.equal(renderReply("{{account}}：{{author}} 你好", item({ accountName: "福利号" })), "福利号：小王 你好");
});

test("每日上限和间隔会拦住回复", () => {
  const now = 1_700_000_000_000;
  assert.equal(replyBlockedReason(rule({ dailyCap: 10 }), { repliesToday: 10, lastReplyAt: 0 }, now, 45), "这条规则今天在这个账号已经到上限（10 条）");
  assert.match(String(replyBlockedReason(rule(), { repliesToday: 1, lastReplyAt: now - 10_000 }, now, 45)), /还要等 35 秒/);
  assert.equal(replyBlockedReason(rule(), { repliesToday: 1, lastReplyAt: now - 60_000 }, now, 45), undefined);
  assert.equal(replyBlockedReason(rule({ dailyCap: 0 }), { repliesToday: 999, lastReplyAt: 0 }, now, 45), undefined);
});

test("规则可以只盯指定账号，不选就是该平台全部号", () => {
  assert.equal(matchRule(rule({ accounts: ["a2"] }), item({ accountId: "a1" })), false);
  assert.equal(matchRule(rule({ accounts: ["a2"] }), item({ accountId: "a2" })), true);
  assert.equal(matchRule(rule({ accounts: [] }), item({ accountId: "a1" })), true);
  // 账号和平台是「且」的关系：平台对了但号不对，照样不匹配
  const r = rule({ platforms: ["douyin"], accounts: ["a2"] });
  assert.equal(matchRule(r, item({ platform: "douyin", accountId: "a1" })), false);
  assert.equal(matchRule(r, item({ platform: "douyin", accountId: "a2" })), true);
  assert.equal(matchRule(r, item({ platform: "bilibili", accountId: "a2" })), false);
});

test("日上限按账号+规则分账，不会被别的规则挤占", () => {
  const now = 1_700_000_000_000;
  // 这个号今天已经回了 30 条（都是别的规则），这条规则自己一条没发 → 不该挡
  assert.equal(replyBlockedReason(rule({ dailyCap: 10 }), { repliesToday: 30, lastReplyAt: 0, ruleRepliesToday: 0 }, now, 45), undefined);
  // 自己用满了才挡，哪怕账号总量还没到
  assert.match(
    String(replyBlockedReason(rule({ dailyCap: 10 }), { repliesToday: 12, lastReplyAt: 0, ruleRepliesToday: 10 }, now, 45)),
    /已经到上限/,
  );
  // 不传分账数时退回总量，兼容老调用方
  assert.match(String(replyBlockedReason(rule({ dailyCap: 10 }), { repliesToday: 10, lastReplyAt: 0 }, now, 45)), /已经到上限/);
});

test("批量回复按账号分组，一个号做完再换下一个号", () => {
  const list = [
    item({ id: "x:a1:1", accountId: "a1" }),
    item({ id: "x:b1:1", accountId: "b1" }),
    item({ id: "x:a1:2", accountId: "a1" }),
    item({ id: "x:b1:2", accountId: "b1" }),
  ];
  const groups = groupByAccount(list);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].map((c) => c.id), ["x:a1:1", "x:a1:2"]);
  assert.deepEqual(groups[1].map((c) => c.id), ["x:b1:1", "x:b1:2"]);
  assert.deepEqual(groupByAccount([]), []);
});

test("抓取合并不会覆盖已回复状态，也不会重复入库", () => {
  const replied = item({ status: "replied", replyText: "已回" });
  const again = item({ content: "这个多少钱？改过的内容" });
  const fresh = item({ id: "douyin:a1:c2", commentId: "c2", content: "支持 mac 吗" });
  const merged = mergeComments([replied], [again, fresh]);
  assert.equal(merged.added, 1);
  assert.equal(merged.list.length, 2);
  const kept = merged.list.find((c) => c.commentId === "c1")!;
  assert.equal(kept.status, "replied");
  assert.equal(kept.content, "这个多少钱？改过的内容");
});

test("队列排序：待回复优先，咨询排在负评和灌水前面", () => {
  const list = sortQueue([
    item({ id: "1", intent: "spam", status: "pending", createdAt: 500 }),
    item({ id: "2", intent: "ask", status: "pending", createdAt: 100 }),
    item({ id: "3", intent: "negative", status: "pending", createdAt: 900 }),
    item({ id: "4", intent: "ask", status: "replied", createdAt: 999 }),
  ]);
  assert.deepEqual(list.map((c) => c.id), ["2", "3", "1", "4"]);
});

test("统计只算待回复里的咨询和负评", () => {
  const s = leadsStats([
    item({ id: "1", intent: "ask", status: "pending" }),
    item({ id: "2", intent: "negative", status: "pending" }),
    item({ id: "3", intent: "ask", status: "replied" }),
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.pending, 2);
  assert.equal(s.ask, 1);
  assert.equal(s.negative, 1);
  assert.equal(s.replied, 1);
});

test("坏配置不会让程序崩：缺话术的规则被丢掉，数值被夹到范围内", () => {
  const parsed = normalizeLeadsSettings({
    rules: [
      { name: "没有话术", keywords: ["a"] },
      { id: "ok", name: "有效", replies: ["  你好  "], dailyCap: 9999, perAccountGapSec: -5, mode: "乱写", accounts: [" a9 ", ""] },
    ],
    autoSend: "yes",
    perAccountGapSec: 9999,
    maxScanWorks: 0,
  });
  assert.equal(parsed.rules.length, 1);
  assert.equal(parsed.rules[0].id, "ok");
  assert.deepEqual(parsed.rules[0].replies, ["你好"]);
  // 老配置没有 accounts 字段，读出来是空数组（等于不限账号）
  assert.deepEqual(parsed.rules[0].accounts, ["a9"]);
  assert.equal(parsed.rules[0].dailyCap, 500);
  assert.equal(parsed.rules[0].mode, "any");
  assert.equal(parsed.autoSend, false);
  assert.equal(parsed.perAccountGapSec, 600);
  assert.equal(parsed.maxScanWorks, 1);
  // 老配置没有 accounts 字段，读出来是空数组（等于不限账号）
  const legacy = normalizeLeadsSettings({ rules: [{ replies: ["hi"] }] });
  assert.deepEqual(legacy.rules[0].accounts, []);
});

test("坏数据整段丢弃时回落到默认设置", () => {
  const parsed = normalizeLeadsSettings("坏字符串");
  assert.deepEqual(parsed.rules, []);
  assert.equal(parsed.autoSend, false);
  assert.equal(parsed.perAccountGapSec, 45);
});

test("评论 ID 由平台、账号和评论三者拼起来，跨账号不会撞", () => {
  assert.equal(commentKey("douyin", "a1", "c1"), "douyin:a1:c1");
  assert.notEqual(commentKey("douyin", "a1", "c1"), commentKey("douyin", "a2", "c1"));
});

/* ------------------------------------------------------------------ *
 * 评论时间与抓取时效
 * ------------------------------------------------------------------ */

// 固定基准时间：2026-11-11 11:00:00（本地时区）
const NOW = new Date(2026, 10, 11, 11, 0, 0).getTime();
const DAY = 86400000;

test("平台上的相对时间能算成真实时间", () => {
  assert.equal(parseCommentTime("刚刚", NOW), NOW);
  assert.equal(parseCommentTime("5分钟前", NOW), NOW - 5 * 60000);
  assert.equal(parseCommentTime("3 小时前", NOW), NOW - 3 * 3600000);
  assert.equal(parseCommentTime("5天前", NOW), NOW - 5 * DAY);
  assert.equal(parseCommentTime("两周前", NOW), NOW - 14 * DAY);
  assert.equal(parseCommentTime("一个月前", NOW), NOW - 30 * DAY);
  assert.equal(parseCommentTime("1年前", NOW), NOW - 365 * DAY);
});

test("昨天、前天、今天带时刻的时间按本地日历算", () => {
  const y = parseCommentTime("昨天 10:20", NOW);
  assert.equal(new Date(y as number).getDate(), 10);
  assert.equal(new Date(y as number).getHours(), 10);
  assert.equal(new Date(y as number).getMinutes(), 20);
  const b = parseCommentTime("前天", NOW);
  assert.equal(new Date(b as number).getDate(), 9);
  assert.equal(new Date(b as number).getHours(), 0);
});

test("带年份的日期原样解析，远古评论不会被当成今天", () => {
  const t = parseCommentTime("2024-10-02", NOW) as number;
  assert.equal(new Date(t).getFullYear(), 2024);
  assert.equal(new Date(t).getMonth() + 1, 10);
  assert.equal(new Date(t).getDate(), 2);
  assert.ok(NOW - t > 700 * DAY, "2024 年的评论应该早于基准时间一年多");

  const cn = parseCommentTime("2026年11月10日 10:33", NOW) as number;
  assert.equal(new Date(cn).getDate(), 10);
  assert.equal(new Date(cn).getHours(), 10);
});

test("只有月日、只有时刻的时间也能认出来", () => {
  const md = parseCommentTime("11-10 10:34", NOW) as number;
  assert.equal(new Date(md).getDate(), 10);
  assert.equal(new Date(md).getMonth() + 1, 11);
  // 晚于今天的月日按去年算，避免把去年 12 月的评论算成未来
  const future = parseCommentTime("12-25", NOW) as number;
  assert.equal(new Date(future).getFullYear(), 2025);
  // 只有时刻：早于现在的算今天，晚于现在的算昨天
  const clock = parseCommentTime("09:15", NOW) as number;
  assert.equal(new Date(clock).getDate(), 11);
  const lateClock = parseCommentTime("23:40", NOW) as number;
  assert.equal(new Date(lateClock).getDate(), 10);
});

test("认不出来的时间不硬猜，交给调用方当时间未知处理", () => {
  assert.equal(parseCommentTime("", NOW), undefined);
  assert.equal(parseCommentTime("说得好", NOW), undefined);
  assert.equal(parseCommentTime("3000", NOW), undefined);
  assert.equal(parseCommentTime("2026-13-45", NOW), undefined);
  assert.equal(parseCommentTime(undefined, NOW), undefined);
});

test("时间戳文本直接当时间用", () => {
  const sec = Math.floor(NOW / 1000);
  assert.equal(parseCommentTime(String(sec), NOW), sec * 1000);
  assert.equal(parseCommentTime(String(NOW), NOW), NOW);
});

test("默认 3 天的窗口会把远古评论挡掉", () => {
  const rows = [
    item({ id: "a", postedAt: NOW - 2 * 3600000, createdAt: NOW }),
    item({ id: "b", postedAt: NOW - 5 * DAY, createdAt: NOW }),
    item({ id: "c", postedAt: parseCommentTime("2024-10-02", NOW), createdAt: NOW }),
  ];
  const r = applyScanWindow(rows, "3d", NOW);
  assert.deepEqual(r.kept.map((x) => x.id), ["a"]);
  assert.equal(r.skipped, 2);
});

test("近 1 天、7 天、30 天窗口各按各的线切", () => {
  const rows = [
    item({ id: "h6", postedAt: NOW - 6 * 3600000, createdAt: NOW }),
    item({ id: "d2", postedAt: NOW - 2 * DAY, createdAt: NOW }),
    item({ id: "d10", postedAt: NOW - 10 * DAY, createdAt: NOW }),
    item({ id: "d45", postedAt: NOW - 45 * DAY, createdAt: NOW }),
  ];
  assert.deepEqual(applyScanWindow(rows, "1d", NOW).kept.map((x) => x.id), ["h6"]);
  assert.deepEqual(applyScanWindow(rows, "3d", NOW).kept.map((x) => x.id), ["h6", "d2"]);
  assert.deepEqual(applyScanWindow(rows, "7d", NOW).kept.map((x) => x.id), ["h6", "d2"]);
  assert.deepEqual(applyScanWindow(rows, "30d", NOW).kept.map((x) => x.id), ["h6", "d2", "d10"]);
  assert.equal(applyScanWindow(rows, "all", NOW).kept.length, 4);
  assert.equal(applyScanWindow(rows, "all", NOW).skipped, 0);
});

test("「只抓最新一条」每个账号只留一条，而且最新那条超期就当没新评论", () => {
  const rows = [
    item({ id: "old", postedAt: NOW - 6 * DAY, createdAt: NOW }),
    item({ id: "mid", postedAt: NOW - 2 * DAY, createdAt: NOW }),
    item({ id: "new", postedAt: NOW - 3600000, createdAt: NOW }),
  ];
  const r = applyScanWindow(rows, "latest", NOW);
  assert.deepEqual(r.kept.map((x) => x.id), ["new"]);

  const stale = [item({ id: "ancient", postedAt: NOW - 400 * DAY, createdAt: NOW })];
  const r2 = applyScanWindow(stale, "latest", NOW);
  assert.equal(r2.kept.length, 0);
  assert.equal(r2.skipped, 1);
});

test("整页都拿不到时间时不做过滤，宁可多收也不把评论全丢掉", () => {
  const rows = [item({ id: "x", timeUnknown: true }), item({ id: "y", timeUnknown: true })];
  const r = applyScanWindow(rows, "3d", NOW);
  assert.equal(r.unfiltered, true);
  assert.equal(r.kept.length, 2);
  assert.equal(r.unknown, 2);
});

test("部分条目没有时间时保守收下，并单独计数", () => {
  const rows = [
    item({ id: "ok", postedAt: NOW - 3600000, createdAt: NOW }),
    item({ id: "noTime", timeUnknown: true }),
    item({ id: "ancient", postedAt: NOW - 100 * DAY, createdAt: NOW }),
  ];
  const r = applyScanWindow(rows, "3d", NOW);
  assert.deepEqual(r.kept.map((x) => x.id), ["ok", "noTime"]);
  assert.equal(r.skipped, 1);
  assert.equal(r.unknown, 1);
  assert.equal(r.unfiltered, false);
});

test("入库的旧评论能被标成超期，但时间未知的不乱标", () => {
  const old = item({ postedAt: NOW - 10 * DAY });
  const fresh = item({ postedAt: NOW - 3600000 });
  const unknown = item({ timeUnknown: true });
  assert.equal(isStale(old, "3d", NOW), true);
  assert.equal(isStale(fresh, "3d", NOW), false);
  assert.equal(isStale(unknown, "3d", NOW), false);
  assert.equal(isStale(old, "all", NOW), false);
  assert.equal(isStale(old, "30d", NOW), false);
  assert.equal(windowCutoff("all", NOW), undefined);
});

test("时间窗口设置能存能读，乱写的值回落成 3 天", () => {
  assert.equal(normalizeLeadsSettings({ scanWindow: "7d" }).scanWindow, "7d");
  assert.equal(normalizeLeadsSettings({ scanWindow: "latest" }).scanWindow, "latest");
  assert.equal(normalizeLeadsSettings({ scanWindow: "999d" }).scanWindow, "3d");
  assert.equal(normalizeLeadsSettings({}).scanWindow, "3d");
});

test("重新抓到时补上真实时间，已处理状态不被覆盖", () => {
  const old = item({ id: "k1", status: "replied", postedAt: undefined, timeUnknown: true });
  const fresh = item({ id: "k1", status: "pending", postedAt: NOW - 2 * DAY, timeText: "2天前" });
  const r = mergeComments([old], [fresh]);
  assert.equal(r.added, 0);
  assert.equal(r.list[0].status, "replied");
  assert.equal(r.list[0].postedAt, NOW - 2 * DAY);
  assert.equal(r.list[0].timeUnknown, false);
});

test("批量回复的间隔：同号按设置走，换号再多停一段，且都有下限", () => {
  const s = { ...normalizeLeadsSettings({}), perAccountGapSec: 45, switchAccountGapSec: 60 };
  assert.equal(replyGapSec(s, true), 45);
  assert.equal(replyGapSec(s, false), 105);
  // 换号多停可以关掉，关掉后退回同号间隔
  assert.equal(replyGapSec({ ...s, switchAccountGapSec: 0 }, false), 45);
  // 设置写 0 也不许连发：兜底 20 秒
  assert.equal(replyGapSec({ ...s, perAccountGapSec: 0 }, true), 20);
  assert.equal(replyGapSec({ ...s, perAccountGapSec: 0, switchAccountGapSec: 0 }, false), 20);
  // 离谱的大值被夹住，不会停几十分钟
  assert.equal(replyGapSec({ ...s, perAccountGapSec: 9999, switchAccountGapSec: 9999 }, false), 900);
});

test("换号间隔的老配置读出来是默认 60 秒，乱写的值被夹到 0–600", () => {
  assert.equal(normalizeLeadsSettings({}).switchAccountGapSec, 60);
  assert.equal(normalizeLeadsSettings({ switchAccountGapSec: 0 }).switchAccountGapSec, 0);
  assert.equal(normalizeLeadsSettings({ switchAccountGapSec: 180 }).switchAccountGapSec, 180);
  assert.equal(normalizeLeadsSettings({ switchAccountGapSec: -30 }).switchAccountGapSec, 0);
  assert.equal(normalizeLeadsSettings({ switchAccountGapSec: 9999 }).switchAccountGapSec, 600);
});
