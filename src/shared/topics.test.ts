import assert from "node:assert/strict";
import test from "node:test";
import { mergeTopics, replaceTopic, splitTopics } from "./topics.ts";

test("pasted text splits on ascii, full-width and other spaces, commas and hashes", () => {
  assert.deepEqual(splitTopics("#办公技巧 #发票打印　财务技巧"), ["办公技巧", "发票打印", "财务技巧"]);
  assert.deepEqual(splitTopics("会计日常 报销\t税务\n发票，打印、技巧,收藏;好物"), ["会计日常", "报销", "税务", "发票", "打印", "技巧", "收藏", "好物"]);
  assert.deepEqual(splitTopics("##双井号＃全角井号"), ["双井号", "全角井号"]);
  assert.deepEqual(splitTopics("  　 "), []);
});

test("merging keeps order and drops duplicates", () => {
  assert.deepEqual(mergeTopics(["a", "b"], ["b", "c", "a"]), ["a", "b", "c"]);
});

test("editing a tag replaces it in place, can split it, or remove it when emptied", () => {
  const tags = ["办公技巧", "发票打印", "财务技巧"];
  assert.deepEqual(replaceTopic(tags, 1, "#发票整理"), ["办公技巧", "发票整理", "财务技巧"]);
  assert.deepEqual(replaceTopic(tags, 1, "发票 打印"), ["办公技巧", "发票", "打印", "财务技巧"]);
  assert.deepEqual(replaceTopic(tags, 1, "  "), ["办公技巧", "财务技巧"]);
  assert.deepEqual(replaceTopic(tags, 0, "财务技巧"), ["财务技巧", "发票打印"]);
});
