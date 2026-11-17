import test from "node:test";
import assert from "node:assert/strict";
import { noteFromText, parseSheetRows, shortenForNote, splitPaths, splitTopics, TEMPLATE_ROWS } from "./note-import.ts";

test("表格：按表头认列，空行跳过，话题和图片拆开", () => {
  const r = parseSheetRows([["标题", "文案", "标签", "图片路径"], ["露营", "第一段\n第二段", "#露营 户外，周末", "a.jpg; b.jpg"], ["", "", "", ""]]);
  assert.equal(r.error, undefined);
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.rows[0], { title: "露营", text: "第一段\n第二段", topics: ["露营", "户外", "周末"], imageRefs: ["a.jpg", "b.jpg"] });
  assert.match(parseSheetRows([["名字", "年龄"], ["a", "1"]]).error!, /标题|正文/);
});

test("txt 文案：短首行当标题，# 行当话题", () => {
  assert.deepEqual(noteFromText("早餐做法\n五分钟搞定。\n吐司鸡蛋。\n#早餐 #快手菜", "文件夹名"), { title: "早餐做法", text: "五分钟搞定。\n吐司鸡蛋。", topics: ["早餐", "快手菜"] });
  assert.equal(noteFromText("只有一行正文", "文件夹名").title, "文件夹名");
});

test("正文截短按整段保留，不超过上限", () => {
  const text = "第一段。\n" + "长".repeat(994) + "\n第三段";
  assert.equal(shortenForNote(text), "第一段。\n" + "长".repeat(994));
  assert.equal(Array.from(shortenForNote("超".repeat(2000))).length, 1000);
  assert.equal(shortenForNote("短"), "短");
});

test("路径和话题拆分", () => {
  assert.deepEqual(splitPaths('"D:/a.jpg";D:/b.jpg|c'), ["D:/a.jpg", "D:/b.jpg", "c"]);
  assert.deepEqual(splitTopics("a a b"), ["a", "b"]);
});

test("表格：下载的模板里自带的示例行不会被当成内容导入", () => {
  const r = parseSheetRows([...TEMPLATE_ROWS, ["我的标题", "我的正文", "", "a.jpg"]]);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].title, "我的标题");
  assert.match(parseSheetRows(TEMPLATE_ROWS).error!, /没有内容行/);
});
