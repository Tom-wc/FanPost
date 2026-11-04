import assert from "node:assert/strict";
import test from "node:test";
import { declarationGaps, declarationOption, isDeclaration } from "./declarations.ts";

test("maps declaration to each platform's own wording", () => {
  assert.equal(declarationOption("weibo", "video", "none"), "我的内容无需声明");
  assert.equal(declarationOption("douyin", "video", "ai"), "内容由AI生成");
  assert.equal(declarationOption("bilibili", "video", "none"), "内容无需标注");
  assert.equal(declarationOption("kuaishou", "video", "none"), undefined);
  assert.equal(declarationOption("douyin", "image_text", "ai"), "内容由AI生成");
  assert.equal(declarationOption("zhihu", "image_text", "none"), "无声明");
  assert.equal(declarationOption("zhihu", "video", "none"), undefined);
});

test("lists platforms that lack the chosen declaration", () => {
  assert.deepEqual(declarationGaps(["douyin", "kuaishou", "qqmedia"], "video", "ai"), []);
  assert.deepEqual(declarationGaps(["douyin", "zhihu", "baijiahao"], "image_text", "opinion"), ["zhihu", "baijiahao"]);
  assert.deepEqual(declarationGaps(["kuaishou"], "video", "none"), []);
});

test("rejects unknown declaration values", () => {
  assert.equal(isDeclaration("ai"), true);
  assert.equal(isDeclaration("hack"), false);
});
