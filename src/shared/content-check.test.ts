import assert from "node:assert/strict";
import test from "node:test";
import { CHECK_OK, CHECK_PREFIX, splitCheck } from "./content-check.ts";

test("splits platform check result off the end of a task message", () => {
  assert.deepEqual(splitCheck("已填好。" + CHECK_OK), { text: "已填好。", check: { ok: true, text: "平台检测：未发现问题" } });
  const issues = CHECK_PREFIX + "用词建议「你好。」；标点问题 3 处。";
  assert.deepEqual(splitCheck("已填好。" + issues), { text: "已填好。", check: { ok: false, text: issues } });
});

test("leaves messages without a check untouched", () => {
  assert.deepEqual(splitCheck("已填好。"), { text: "已填好。" });
});
