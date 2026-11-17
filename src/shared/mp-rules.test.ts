import test from "node:test";
import assert from "node:assert/strict";
import { MP_RULES, checkMpArticle } from "./mp-rules.ts";
import { BLANK_MP, parseMpDrafts, upsertMpDraft } from "./mp-drafts.ts";

const ok = { ...BLANK_MP, title: "标题", text: "正文内容", images: ["C:/a.jpg"] };

test("合格的文章没有错误，只提醒没填摘要", () => {
  const r = checkMpArticle(ok);
  assert.deepEqual(r.filter((i) => i.level === "error"), []);
  assert.ok(r.some((i) => /摘要/.test(i.text)));
});

test("标题、作者、摘要超长、原文链接不对算错误；没封面只提醒会自动生成", () => {
  const r = checkMpArticle({ ...ok, title: "字".repeat(MP_RULES.titleMax + 1), author: "名".repeat(MP_RULES.authorMax + 1), digest: "摘".repeat(MP_RULES.digestMax + 1), images: [], sourceUrl: "abc" });
  const errs = r.filter((i) => i.level === "error").map((i) => i.text).join("|");
  for (const k of ["标题超出 1 字", "作者超出 1 字", "摘要超出 1 字", "原文链接"]) assert.ok(errs.includes(k), k);
  assert.ok(r.some((i) => i.level === "warn" && /自动生成一张封面/.test(i.text)));
});

test("空标题空正文报错；正文带网址提醒", () => {
  const r = checkMpArticle({ ...BLANK_MP, cover: "c.jpg", text: "" });
  assert.equal(r.filter((i) => i.level === "error").length, 2);
  assert.ok(checkMpArticle({ ...ok, text: "看 https://x.com" }).some((i) => /网址/.test(i.text)));
});

test("公众号草稿读回时丢掉坏数据，更新保留已存公众号的记录", () => {
  const list = parseMpDrafts([{ id: "a", title: "t", text: "x", images: ["1.jpg", 2], mediaId: "m1", savedToMpAt: "2026-11-03T00:00:00Z", createdAt: "2026-11-01T00:00:00Z" }, { title: "无 id" }, "x"]);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].images, ["1.jpg"]);
  const next = upsertMpDraft(list, { ...BLANK_MP, title: "新" }, "a", "2026-11-04T00:00:00Z");
  assert.equal(next[0].mediaId, "m1");
  assert.equal(next[0].createdAt, "2026-11-01T00:00:00Z");
  assert.equal(next[0].title, "新");
});

test("只有图片的正文（PDF 逐页转图）不算空", () => {
  const imageOnly = { ...BLANK_MP, title: "红头文件", text: "", html: '<p><img src="fpimg://local/a.png"></p>', images: ["a.png"] };
  assert.equal(checkMpArticle(imageOnly).some((i) => i.text === "正文不能为空"), false);
  assert.equal(checkMpArticle({ ...BLANK_MP, title: "空文章", text: "", html: "", images: [] }).some((i) => i.text === "正文不能为空"), true);
});
