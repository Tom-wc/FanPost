import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  accountLabel,
  accountWho,
  countByPlatform,
  groupByPlatform,
  interleaveByPlatform,
  normalizeRemark,
  normalizeSettings,
} from "../shared/accounts.ts";

const t = (id: string, platform: "douyin" | "kuaishou" | "zhihu") => ({ id, platform });

test("interleave spreads same-platform accounts apart", () => {
  const order = interleaveByPlatform([t("d1", "douyin"), t("d2", "douyin"), t("d3", "douyin"), t("k1", "kuaishou"), t("z1", "zhihu")]);
  assert.deepEqual(order.map((x) => x.id), ["d1", "k1", "z1", "d2", "d3"]);
});

test("interleave keeps single-account order unchanged", () => {
  const items = [t("d1", "douyin"), t("k1", "kuaishou"), t("z1", "zhihu")];
  assert.deepEqual(interleaveByPlatform(items), items);
});

test("settings are clamped and defaulted", () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({ imageConcurrency: 0, videoConcurrency: 99, samePlatformGapMin: -4 }), { imageConcurrency: 1, videoConcurrency: 9, samePlatformGapMin: 0, historyRetention: "forever", systemNotify: "action" });
  assert.deepEqual(normalizeSettings({ imageConcurrency: "x", videoConcurrency: 2.6, samePlatformGapMin: 2.6, gapMinSec: 60 }), { imageConcurrency: 4, videoConcurrency: 3, samePlatformGapMin: 3, historyRetention: "forever", systemNotify: "action" });
});

test("remark trims, caps length and drives labels", () => {
  assert.equal(normalizeRemark("  主号  "), "主号");
  assert.equal(normalizeRemark("一".repeat(30)).length, 20);
  assert.equal(normalizeRemark(42), "");
  assert.equal(accountLabel({ name: "浪叉官方", remark: "主号" }), "主号");
  assert.equal(accountLabel({ name: "浪叉官方", remark: " " }), "浪叉官方");
  assert.equal(accountWho({ platform: "douyin", name: "浪叉官方", remark: "门店号" }), "抖音 · 门店号");
  assert.deepEqual(countByPlatform([{ platform: "douyin" }, { platform: "douyin" }, { platform: "zhihu" }]), { douyin: 2, zhihu: 1 });
});

test("groupByPlatform keeps first-seen platform order and account order", () => {
  const items = [
    { id: "x1", platform: "xiaohongshu" as const },
    { id: "d1", platform: "douyin" as const },
    { id: "x2", platform: "xiaohongshu" as const },
  ];
  assert.deepEqual(groupByPlatform(items).map((q) => q.map((i) => i.id)), [["x1", "x2"], ["d1"]]);
  assert.deepEqual(groupByPlatform([]), []);
});
