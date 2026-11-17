import assert from "node:assert/strict";
import test from "node:test";
import { classify, parseBlocks, typesetText } from "./mp-typeset.ts";
import { MP_STYLES, DEFAULT_MP_STYLE, swatches, tuneStyle } from "./mp-style.ts";

const tk = MP_STYLES[0];

test("中文序号按级识别成标题，Markdown 的 # 也能认", () => {
  // 中文序号留在标题里，层级靠样式区分
  assert.deepEqual(classify("一、背景"), { type: "h1", text: "一、背景" });
  assert.deepEqual(classify("（一）现状"), { type: "h2", text: "（一）现状" });
  assert.deepEqual(classify("(二) 问题"), { type: "h2", text: "(二) 问题" });
  assert.deepEqual(classify("【重点】"), { type: "h3", text: "【重点】" });
  // Markdown 的井号是纯标记，要剥掉
  assert.deepEqual(classify("# 大标题"), { type: "h1", text: "大标题" });
  assert.deepEqual(classify("### 三级"), { type: "h2", text: "三级" });
  assert.deepEqual(classify("#### 四级"), { type: "h3", text: "四级" });
  assert.deepEqual(classify("普通一行字"), { type: "p", text: "普通一行字" });
});

test("「一、」后面跟一长串话时不提升成标题，免得正文被切碎", () => {
  const long = "一、" + "这是一整段话，只是恰好以中文序号开头，写作者经常这么分段，不应该被当成标题处理掉。";
  assert.equal(classify(long)!.type, "p");
  // 24 字以内才认
  assert.equal(classify("二、这次改动涉及三块")!.type, "h1");
});

test("列表连续行合并，缩进两格算一层", () => {
  const blocks = parseBlocks("- 第一项\n- 第二项\n  - 子项\n\n普通段落");
  assert.equal(blocks.length, 2);
  const list = blocks[0]!;
  assert.equal(list.type, "ul");
  if (list.type !== "ul") return;
  assert.equal(list.items.length, 3);
  assert.equal(list.items[2]!.level, 1);
  assert.equal(blocks[1]!.type, "p");
});

test("有序列表认得 1. 和 1、两种写法", () => {
  const b = parseBlocks("1. 甲\n2、乙");
  assert.equal(b[0]!.type, "ol");
  if (b[0]!.type !== "ol") return;
  assert.deepEqual(
    b[0]!.items.map((i) => i.text),
    ["甲", "乙"],
  );
});

test("表格要有分隔行才认，否则当普通段落", () => {
  const ok = parseBlocks("| 项目 | 价格 |\n| --- | --- |\n| A | 10 |\n| B | 20 |");
  assert.equal(ok[0]!.type, "table");
  if (ok[0]!.type !== "table") return;
  assert.deepEqual(ok[0]!.head, ["项目", "价格"]);
  assert.equal(ok[0]!.rows.length, 2);
  assert.deepEqual(ok[0]!.rows[1], ["B", "20"]);

  const noSep = parseBlocks("| 就是一句话 | 里面有竖线 |");
  assert.equal(noSep[0]!.type, "table"); // 单行当表头，不炸
});

test("围栏代码块整块吃掉，里面的 # 和 - 不当标题", () => {
  const b = parseBlocks("```js\n# 不是标题\n- 不是列表\n```");
  assert.equal(b.length, 1);
  assert.equal(b[0]!.type, "code");
  if (b[0]!.type !== "code") return;
  assert.equal(b[0]!.lang, "js");
  assert.match(b[0]!.text, /# 不是标题/);
});

test("行内标记：粗体、代码、链接，危险协议一律降级成 #", () => {
  const html = typesetText("这里有 **重点** 和 `code` 还有 [链接](https://a.com)", tk);
  assert.match(html, /<strong style="color:#1a1a2e;font-weight:700">重点<\/strong>/);
  assert.match(html, /<code style="[^"]*">code<\/code>/);
  assert.match(html, /href="https:\/\/a\.com"/);
  const bad = typesetText("[点我](javascript:alert(1))", tk);
  assert.match(bad, /href="#"/);
  assert.doesNotMatch(bad, /javascript:/);
});

test("未知标签被转义，不会把 HTML 注进正文", () => {
  const html = typesetText("<script>alert(1)</script>", tk);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("排版结果全是内联样式，且带外层 section 兜字体", () => {
  const html = typesetText("一、背景\n\n正文一段\n\n- 甲\n- 乙", tk);
  assert.match(html, /^<section style="/);
  assert.match(html, /<h1 style="/);
  assert.match(html, /<p style="/);
  assert.match(html, /<ul style="/);
  // 公众号会剥 class 和 <style>，出现任何一个都说明方向错了
  assert.doesNotMatch(html, /class=/);
  assert.doesNotMatch(html, /<style/);
});

test("图片保留原始 src 和 data-fp-kind，序号列表不会被当成标题", () => {
  const html = typesetText("![封面](fpimg://local/C%3A%5Ctmp%5Ca.png)", tk);
  assert.match(html, /src="fpimg:\/\/local\/C%3A%5Ctmp%5Ca\.png"/);
  assert.match(html, /data-fp-kind="body"/);
});

test("段落间距、缩进、字号跟着模板走", () => {
  const tight = tuneStyle(tk, { bodySize: 14, paraGap: 0.5, indent: true, lineHeight: 2 });
  const html = typesetText("正文", tight);
  assert.match(html, /font-size:14px/);
  assert.match(html, /margin:0 0 0\.5em 0/);
  assert.match(html, /text-indent:2em/);
  assert.match(html, /line-height:2/);
});

test("改主色会连标题、强调、链接、引用竖条、表头一起改，不会撞色", () => {
  const blue = tuneStyle(tk, { accent: "#8c1f28" });
  assert.equal(blue.h1.color, "#8c1f28");
  assert.equal(blue.h2.color, "#8c1f28");
  assert.equal(blue.strongColor, "#8c1f28");
  assert.equal(blue.linkColor, "#8c1f28");
  assert.equal(blue.quote.borderColor, "#8c1f28");
  assert.equal(blue.table.headBg, "#8c1f28");
  // 不改主色时原样返回
  assert.equal(tuneStyle(tk, { bodySize: 15 }).h1.color, tk.h1.color);
});

test("内置模板都有名字和可用的主色，色卡不重复到没法认", () => {
  assert.ok(MP_STYLES.length >= 6);
  for (const s of MP_STYLES) {
    assert.ok(s.name.trim().length > 0);
    assert.match(s.h1.color, /^#[0-9a-f]{6}$/i);
    assert.ok(s.bodySize >= 12 && s.bodySize <= 24);
    assert.equal(swatches(s).length, 5);
  }
  assert.equal(DEFAULT_MP_STYLE.name, MP_STYLES[0]!.name);
});
