import assert from "node:assert/strict";
import test from "node:test";
import { buildPrompt } from "./prompts.ts";

const sys = (m: { role: string; content: string }[]) => m[0].content;
const user = (m: { role: string; content: string }[]) => m[1].content;

test("title prompt uses the platform title limit", () => {
  const douyinVideo = buildPrompt("title", { text: "发票打印助手介绍", platform: "douyin", type: "video" });
  assert.match(sys(douyinVideo), /不超过 30 个汉字/);
  const douyinNote = buildPrompt("title", { text: "发票打印助手介绍", platform: "douyin", type: "image_text" });
  assert.match(sys(douyinNote), /不超过 20 个汉字/);
  const zhihu = buildPrompt("title", { text: "x", platform: "zhihu", type: "image_text" });
  assert.match(sys(zhihu), /不超过 100 个汉字/);
});

test("explicit limit overrides the platform rule", () => {
  const m = buildPrompt("title", { text: "x", platform: "zhihu", type: "image_text", limit: 12 });
  assert.match(sys(m), /不超过 12 个汉字/);
});

test("every action forbids small talk and markdown fences", () => {
  for (const action of ["polish", "expand", "shorten", "title", "topics", "rewrite", "reply"] as const) {
    const m = buildPrompt(action, { text: "一段文案", platform: "xiaohongshu", type: "image_text" });
    assert.match(sys(m), /只输出可以直接粘贴使用的结果/);
    assert.equal(m.length, 2);
    assert.equal(m[1].role, "user");
  }
});

test("reply prompt forbids contact info and promises", () => {
  const m = buildPrompt("reply", { text: "多少钱？", instruction: "发票打印工具" });
  assert.match(sys(m), /不超过 40 字/);
  assert.match(sys(m), /不提任何联系方式、不引导站外、不承诺疗效或收益/);
  assert.match(user(m), /多少钱？/);
  assert.match(user(m), /背景：发票打印工具/);
});

test("rewrite prompt carries the target platform name and its style", () => {
  const m = buildPrompt("rewrite", { text: "原文", platform: "zhihu", type: "image_text" });
  assert.match(user(m), /目标平台：知乎/);
  assert.match(sys(m), /理性、讲逻辑/);
});

test("topics prompt asks for eight comma separated tags without hash", () => {
  const m = buildPrompt("topics", { text: "内容", platform: "weibo" });
  assert.match(sys(m), /8 个话题词/);
  assert.match(sys(m), /不带井号/);
});

test("missing platform still produces a usable prompt", () => {
  const m = buildPrompt("polish", { text: "原文" });
  assert.match(sys(m), /只输出可以直接粘贴使用的结果/);
  assert.match(user(m), /原文/);
});
