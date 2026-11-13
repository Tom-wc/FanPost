import assert from "node:assert/strict";
import test from "node:test";
import { buildTemplateFile, fillSkin, hasSkins, parseTemplate, readTemplateFile, recolorSkin, skinSummary, SKIN_MAX } from "./mp-template.ts";
import { DEFAULT_MP_STYLE } from "./mp-style.ts";

const base = { id: "t1", name: "测试模板", createdAt: 1, source: "", tokens: DEFAULT_MP_STYLE, skins: {} };

test("骨架里的占位符被内容替换；内容里的 $& 不会被当成替换模式", () => {
  assert.equal(fillSkin("<p>{{c}}</p>", "正文"), "<p>正文</p>");
  assert.equal(fillSkin("<p>{{c}}</p>", "A$&B$1"), "<p>A$&B$1</p>");
});

test("没有占位符的骨架（分割线）原样返回", () => {
  assert.equal(fillSkin('<section style="height:1px"></section>', "不该出现"), '<section style="height:1px"></section>');
});

test("主色一改，骨架里的同色一起换，且不分大小写", () => {
  const skin = '<span style="color:#C75B12;border:1px solid #c75b12">x</span>';
  assert.equal(recolorSkin(skin, "#c75b12", "#2b6cb0"), '<span style="color:#2b6cb0;border:1px solid #2b6cb0">x</span>');
  // 空值或同色时不动，避免把骨架改坏
  assert.equal(recolorSkin(skin, "", "#000000"), skin);
  assert.equal(recolorSkin(skin, "#c75b12", "#c75b12"), skin);
});

test("有骨架才算带结构，列表和说明文字跟着变", () => {
  assert.equal(hasSkins(base), false);
  assert.equal(skinSummary(base), "");
  const t = { ...base, skins: { h1: "<p>{{c}}</p>", hr: "<hr>" } };
  assert.equal(hasSkins(t), true);
  assert.equal(skinSummary(t), "含大标题、分割线");
});

test("读回来时字段不全也能用：缺的用同名内置模板兜底", () => {
  const t = parseTemplate({ name: "提取的模板", tokens: { name: "提取的模板", bodySize: 17, bodyColor: "#333333" } });
  assert.ok(t);
  assert.equal(t.tokens.bodySize, 17);
  assert.equal(t.tokens.h1.size, DEFAULT_MP_STYLE.h1.size);
  assert.equal(t.skins.h1, undefined);
});

test("坏数据一律当没有，不硬凑", () => {
  assert.equal(parseTemplate(undefined), undefined);
  assert.equal(parseTemplate({ tokens: DEFAULT_MP_STYLE }), undefined);
  assert.equal(parseTemplate({ name: "空", tokens: {} }), undefined);
});

test("超长骨架不收：宁可少一块装饰，也不把整篇文章塞进模板", () => {
  const big = "<section>" + "x".repeat(SKIN_MAX + 10) + "{{c}}</section>";
  const t = parseTemplate({ ...base, skins: { p: big, h1: "<p>{{c}}</p>" } });
  assert.ok(t);
  assert.equal(t.skins.p, undefined);
  assert.equal(t.skins.h1, "<p>{{c}}</p>");
});

test("导入文件认两种写法：模板文件或裸数组", () => {
  const file = buildTemplateFile([{ ...base, skins: { p: "<p>{{c}}</p>" } }]);
  assert.equal(readTemplateFile(file).length, 1);
  assert.equal(readTemplateFile([base]).length, 1);
  assert.throws(() => readTemplateFile({ templates: [] }), /没有能用的模板/);
  assert.throws(() => readTemplateFile({ hello: 1 }), /不是模板文件/);
});

test("导入的骨架带脚本或事件属性一律丢弃", () => {
  const evil = parseTemplate({ ...base, skins: { p: '<img src=x onerror="alert(1)">{{c}}', h1: "<section style=\"color:red\">{{c}}</section>" } });
  assert.ok(evil);
  assert.equal(evil!.skins.p, undefined);
  assert.ok(evil!.skins.h1);
  assert.equal(parseTemplate({ ...base, skins: { p: "<script>alert(1)</script>{{c}}" } })!.skins.p, undefined);
  assert.equal(parseTemplate({ ...base, skins: { p: '<section style="background:url(javascript:alert(1))">{{c}}</section>' } })!.skins.p, undefined);
});

test("非分割线骨架没有占位符会吞正文，不收", () => {
  const t = parseTemplate({ ...base, skins: { p: "<section>固定文字</section>", hr: "<section style=\"border-top:1px solid #ccc\"></section>" } });
  assert.equal(t!.skins.p, undefined);
  assert.ok(t!.skins.hr);
});

test("导入的模板重新分配 id，避免和已有模板撞", () => {
  const out = readTemplateFile([{ ...base, id: "dup" }, { ...base, name: "另一个", id: "dup" }]);
  assert.notEqual(out[0]!.id, "dup");
  assert.notEqual(out[0]!.id, out[1]!.id);
});
