import test from "node:test";
import assert from "node:assert/strict";
import { batchSummary, countBuckets, taskBucket } from "./task-outcome.ts";
import type { Platform, TaskStatus } from "./types.ts";

const t = (platform: Platform, status: TaskStatus, message = "") => ({ platform, status, message });
const name = (p: Platform) => ({ xiaohongshu: "小红书", baijiahao: "百家号", zhihu: "知乎" } as Record<string, string>)[p] || p;

test("auto-submitted tasks waiting for backend are not counted as needing the user", () => {
  assert.equal(taskBucket(t("zhihu", "manual_required", "已自动点击发布，平台后台暂未查到（可能在审核中），稍后会自动再查")), "confirming");
  assert.equal(taskBucket(t("zhihu", "manual_required", "自动发布未完成：未找到可点击的「发布」按钮")), "needs_you");
  assert.equal(taskBucket(t("zhihu", "publishing")), "running");
});

test("auto batch summary names which platforms need the user and why", () => {
  const tasks = [
    t("zhihu", "success"),
    t("zhihu", "success"),
    t("xiaohongshu", "manual_required", "自动发布未完成：未找到可点击的「发布」按钮。内容已填好"),
    t("xiaohongshu", "manual_required", "自动发布未完成：未找到可点击的「发布」按钮。内容已填好"),
    t("baijiahao", "manual_required", "自动发布未完成：平台弹出了安全验证（拖动滑块/扫码），需要你本人完成"),
    t("zhihu", "manual_required", "已自动点击发布，平台后台暂未查到"),
  ];
  const s = batchSummary(tasks, true, name);
  assert.equal(s.head, "已发布 2/6");
  assert.equal(s.needsYou, 3);
  assert.match(s.message, /小红书×2 没找到发布按钮/);
  assert.match(s.message, /百家号 要你完成安全验证/);
  assert.match(s.message, /等后台确认 1/);
  assert.deepEqual(countBuckets(tasks), { ok: 2, failed: 0, confirming: 1, needs_you: 3, running: 0, dismissed: 0 });
});

test("fill-only batch summary keeps the plain wording", () => {
  const s = batchSummary([t("zhihu", "manual_required", "知乎标题、正文已填好"), t("zhihu", "failed", "x")], false, name);
  assert.equal(s.message, "共 2 个账号：待你检查并点发布 1，失败 1。");
});
