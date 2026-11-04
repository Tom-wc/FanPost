import test from "node:test";
import assert from "node:assert/strict";
import { COMMON_IMAGE_MAX, cutText, cutTitle, fitImport, importPlatforms } from "./import-fit.ts";

test("正文截断优先停在句号或换行，太靠前就硬截加省略号", () => {
  assert.equal(cutText("第一句话。第二句话很长很长", 8), "第一句话。");
  assert.equal(cutText("没有标点的一长串文字内容", 6), "没有标点的…");
  assert.equal(cutText("短", 10), "短");
});

test("标题超长时优先用分隔符前后的完整一段", () => {
  assert.equal(cutTitle("金秋时节农村都在忙什么 | 新华网专题报道", 20), "金秋时节农村都在忙什么");
  assert.equal(Array.from(cutTitle("一二三四五六七八九十一二三四五六七八九十一二三", 20)).length, 20);
});

test("按选中平台生成缩短版：抖音/小红书标题 20 字、快手合并后 500 字；没超的平台不生成", () => {
  const title = "这是一个超过二十个字的很长很长很长的标题文字内容";
  const text = "段落内容。".repeat(250);
  const r = fitImport({ title, text, images: Array.from({ length: 30 }, (_, i) => i + ".jpg") }, ["xiaohongshu", "kuaishou", "zhihu"]);
  assert.equal(r.images.length, COMMON_IMAGE_MAX);
  assert.ok(Array.from(r.overrides.xiaohongshu!.title!).length <= 20);
  assert.ok(Array.from(r.overrides.xiaohongshu!.description!).length <= 1000);
  assert.ok(Array.from(title + "\n" + r.overrides.kuaishou!.description!).length <= 500);
  assert.equal(r.overrides.zhihu, undefined);
  assert.equal(r.notes.length, 2);
});

test("导入沿用上次选的图文账号，没选过就全选；视频号不支持图文被排除", () => {
  const accounts = [{ id: "a", platform: "douyin" as const }, { id: "b", platform: "weixin" as const }, { id: "c", platform: "zhihu" as const }];
  assert.deepEqual(importPlatforms(accounts, undefined), { accountIds: ["a", "c"], platforms: ["douyin", "zhihu"] });
  assert.deepEqual(importPlatforms(accounts, ["c", "b"]), { accountIds: ["c"], platforms: ["zhihu"] });
});
