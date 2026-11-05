import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { TUTORIAL_SECTIONS, slugify, topicSlug, tutorialHeadings, type TutorialTopic } from "./tutorial.ts";

const md = readFileSync(new URL("../../docs/使用教程.md", import.meta.url), "utf8");
const slugs = new Set(tutorialHeadings(md).map((h) => h.slug));

test("slug 规则和教程目录里的锚点一致", () => {
  assert.equal(slugify("操作 1：添加平台账号"), "操作-1添加平台账号");
  assert.equal(slugify("5 分钟上手：发一篇图文到 4 个平台"), "5-分钟上手发一篇图文到-4-个平台");
  assert.equal(slugify("安全检查：敏感词、每日次数、照搬比例"), "安全检查敏感词每日次数照搬比例");
});

test("软件里每个跳转入口都能在教程里找到对应章节", () => {
  for (const topic of Object.keys(TUTORIAL_SECTIONS) as TutorialTopic[]) assert.ok(slugs.has(topicSlug(topic)), "教程里缺少章节：" + TUTORIAL_SECTIONS[topic]);
});

test("教程里的站内链接都指向存在的标题", () => {
  const links = [...md.matchAll(/\]\(#([^)]+)\)/g)].map((m) => decodeURIComponent(m[1]));
  assert.ok(links.length > 10);
  for (const l of links) assert.ok(slugs.has(l), "找不到锚点：" + l);
});
