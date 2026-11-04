import fs from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import type { AppData } from "../shared/types.ts";
import {
  MAX_KEPT_NOTIFICATIONS,
  loginTransition,
  pushNotification,
  taskNotification,
  wantsSystemToast,
} from "./notify-core.ts";
import { checkContent, contentFor, isAssisted, platformRule, supportsType, titleLength, weixinShortTitle, weixinVideoTitle } from "../shared/platform-rules.ts";

const blank = (): AppData => ({
  accounts: [],
  drafts: [],
  savedDrafts: [],
  tasks: [],
  accountSelections: {},
  notifications: [],
  settings: { imageConcurrency: 4, videoConcurrency: 3, samePlatformGapMin: 10, historyRetention: "forever", systemNotify: "action" },
  publishLog: [],
  mpDrafts: [],
});

test("unread notification with the same kind/account/task is replaced, not duplicated", () => {
  const data = blank();
  const input = { level: "warning" as const, kind: "account_offline" as const, title: "掉线", message: "", accountId: "a1" };
  pushNotification(data, input, "n1", "t1");
  pushNotification(data, input, "n2", "t2");
  assert.deepEqual(data.notifications.map((n) => n.id), ["n2"]);
});

test("read notifications are kept when a new one with the same key arrives", () => {
  const data = blank();
  const input = { level: "warning" as const, kind: "account_offline" as const, title: "掉线", message: "", accountId: "a1" };
  pushNotification(data, input, "n1", "t1");
  data.notifications[0].read = true;
  pushNotification(data, input, "n2", "t2");
  assert.deepEqual(data.notifications.map((n) => n.id), ["n2", "n1"]);
});

test("notification list is capped", () => {
  const data = blank();
  for (let i = 0; i < MAX_KEPT_NOTIFICATIONS + 20; i++)
    pushNotification(data, { level: "info", kind: "batch_done", title: "x", message: "", taskId: String(i) }, "n" + i, "t");
  assert.equal(data.notifications.length, MAX_KEPT_NOTIFICATIONS);
  assert.equal(data.notifications[0].id, "n" + (MAX_KEPT_NOTIFICATIONS + 19));
});

test("task statuses map to notification levels; in-progress statuses are silent", () => {
  assert.equal(taskNotification("success", "知乎", "A", "t", "")?.level, "success");
  assert.equal(taskNotification("failed", "知乎", "A", "t", "x")?.level, "error");
  assert.equal(taskNotification("manual_required", "知乎", "A", "t", "x")?.kind, "manual_required");
  assert.equal(taskNotification("uploading", "知乎", "A", "t", "x"), undefined);
});

test("login transitions only fire on edges", () => {
  assert.equal(loginTransition("logged_in", "logged_out"), "offline");
  assert.equal(loginTransition(undefined, "logged_out"), "offline");
  assert.equal(loginTransition("logged_out", "logged_out"), undefined);
  assert.equal(loginTransition("logged_out", "logged_in"), "online");
  assert.equal(loginTransition(undefined, "logged_in"), undefined);
  assert.equal(loginTransition("logged_in", "logged_in"), undefined);
});

test("per-platform override falls back to common content field by field", () => {
  const draft = {
    id: "d", type: "image_text" as const, title: "通用标题", description: "通用正文", topics: ["a"],
    mediaPaths: [], accountIds: [], createdAt: "",
    overrides: { douyin: { title: "抖音短标题" } },
  };
  assert.deepEqual(contentFor(draft, "douyin"), { title: "抖音短标题", description: "通用正文", topics: ["a"], coverPath: undefined });
  assert.equal(contentFor(draft, "zhihu").title, "通用标题");
});

test("title limits per platform", () => {
  assert.equal(platformRule("douyin", "image_text").titleMax, 20);
  assert.equal(platformRule("zhihu", "image_text").titleMax, 100);
  assert.equal(platformRule("weibo", "image_text").titleMax, undefined);
  assert.equal(platformRule("kuaishou", "image_text").mergeTitleIntoBody, true);
});

test("kuaishou video has no title box so title merges into body", () => {
  assert.equal(platformRule("kuaishou", "video").mergeTitleIntoBody, true);
  assert.equal(platformRule("douyin", "video").mergeTitleIntoBody, undefined);
  assert.equal(platformRule("weibo", "video").mergeTitleIntoBody, true);
  assert.equal(platformRule("weibo", "video").bodyMax, 2000);
});

test("emoji counts as one character toward title limits", () => {
  assert.equal(titleLength("🧾".repeat(20)), 20);
  assert.equal(titleLength("发票🧾"), 3);
});

test("weixin short title enforces 6-16 chars and allowed symbols", () => {
  const c = (title: string) => checkContent("weixin", "video", { title, description: "", topics: [] }).map((i) => i.field);
  assert.deepEqual(c("发票打印助手上线"), []);
  assert.deepEqual(c("发票打印"), ["title"]);
  assert.deepEqual(c("一".repeat(17)), ["title"]);
  assert.deepEqual(c("发票打印助手！上线啦"), ["title"]);
  assert.deepEqual(c("《发票打印助手》上线"), []);
});

test("checkContent flags body, image and topic limits", () => {
  const xhs = checkContent("xiaohongshu", "image_text", { title: "标题", description: "字".repeat(1001), topics: Array(11).fill("t") }, 19);
  assert.deepEqual(xhs.map((i) => [i.field, i.level]), [["body", "error"], ["images", "error"], ["topics", "warn"]]);
  assert.deepEqual(checkContent("zhihu", "image_text", { title: "标题", description: "字".repeat(5000), topics: [] }, 40), []);
});

test("merged-title platforms count title toward body limit", () => {
  const issues = checkContent("kuaishou", "video", { title: "一".repeat(300), description: "二".repeat(200), topics: [] });
  assert.deepEqual(issues.map((i) => i.field), ["body"]);
});

test("supportsType reflects which platforms can fill each content type", () => {
  assert.equal(supportsType("zhihu", "image_text"), true);
  assert.equal(supportsType("zhihu", "video"), false);
  assert.equal(supportsType("baijiahao", "video"), false);
  assert.equal(supportsType("weixin", "image_text"), false);
  assert.equal(supportsType("bilibili", "image_text"), false);
  assert.equal(supportsType("weibo", "video"), true);
  assert.equal(supportsType("douyin", "image_text"), true);
});

test("weibo image posts and videos are both automated", () => {
  assert.equal(isAssisted("weibo", "image_text"), false);
  assert.equal(isAssisted("weibo", "video"), false);
  assert.equal(isAssisted("douyin", "video"), false);
});

test("auto submit covers every platform for each content type it supports", { skip: !fs.existsSync(new URL("../../dev/platform-pack/submit-rules.mjs", import.meta.url)) }, async () => {
  const { submitRules } = await import("../../dev/platform-pack/submit-rules.mjs");
  const { platforms } = await import("../shared/platforms.ts");
  for (const p of platforms) {
    for (const type of ["video", "image_text"] as const) {
      if (!supportsType(p.id, type)) continue;
      assert.ok(submitRules[p.id]?.[type], p.id + " " + type);
    }
  }
});

test("weixin video title drops unsupported symbols and keeps 6-16 chars", () => {
  assert.equal(weixinShortTitle("【测试勿发】竖版封面核查"), "测试勿发 竖版封面核查");
  assert.equal(weixinShortTitle("价格:多少?"), "价格：多少？");
  assert.equal(weixinVideoTitle("【短】", "补充说明文字很长很长"), "短 补充说明文字很长很长");
  assert.equal(Array.from(weixinVideoTitle("一二三四五六七八九十一二三四五六七八", "")).length, 16);
});

test("system toast follows the notify setting", () => {
  const filled = { level: "warning" as const, kind: "manual_required" as const, message: "抖音视频已上传，标题/简介已填好" };
  const blocked = { level: "warning" as const, kind: "manual_required" as const, message: "封面未设置成功（抖音封面未能保存）" };
  const failed = { level: "error" as const, kind: "publish_failed" as const, message: "上传超时" };
  const success = { level: "success" as const, kind: "publish_success" as const, message: "标题" };
  const batchOk = { level: "info" as const, kind: "batch_done" as const, message: "共 3 个账号" };
  const batchBad = { level: "warning" as const, kind: "batch_done" as const, message: "失败 1 个" };
  assert.equal(wantsSystemToast("all", filled), true);
  assert.equal(wantsSystemToast("all", success), true);
  assert.equal(wantsSystemToast("action", filled), false);
  assert.equal(wantsSystemToast("action", blocked), true);
  assert.equal(wantsSystemToast("action", failed), true);
  assert.equal(wantsSystemToast("action", success), false);
  assert.equal(wantsSystemToast("action", batchOk), true);
  assert.equal(wantsSystemToast("action", batchBad), true);
  assert.equal(wantsSystemToast("off", failed), false);
  assert.equal(wantsSystemToast("all", failed, false), false);
});
