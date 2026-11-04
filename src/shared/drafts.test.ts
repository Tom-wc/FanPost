import assert from "node:assert/strict";
import test from "node:test";
import { BLANK_SNAPSHOT, draftLabel, parseDraftInput, parseSavedDrafts, snapshotKey, upsertDraft } from "./drafts.ts";
import type { SavedDraft } from "./types.ts";

const input = { type: "image_text" as const, title: "标题", description: "正文", topics: ["办公"], mediaPaths: ["a.jpg"], accountIds: ["acc"], overrides: {} };

test("draft input keeps valid fields and drops junk", () => {
  assert.equal(parseDraftInput({ type: "music" }), undefined);
  assert.equal(parseDraftInput(null), undefined);
  const parsed = parseDraftInput({
    ...input,
    topics: ["办公", 3],
    coverPath: "",
    overrides: { xiaohongshu: { enabled: true, title: "小红书标题", topics: ["x"] }, nope: { enabled: true }, douyin: "bad" },
  });
  assert.deepEqual(parsed, { ...input, overrides: { xiaohongshu: { enabled: true, title: "小红书标题", topics: ["x"] } } });
});

test("saved drafts without id or type are skipped when loading", () => {
  const list = parseSavedDrafts([{ ...input, id: "d1", createdAt: "2026-10-23T00:00:00Z" }, { ...input }, { id: "x", type: "bad" }, "junk"]);
  assert.equal(list.length, 1);
  assert.equal(list[0].updatedAt, "2026-10-23T00:00:00Z");
  assert.deepEqual(parseSavedDrafts(undefined), []);
});

test("upsert inserts new drafts first and updates existing ones in place of the old copy", () => {
  const first = upsertDraft([], input, "d1", "t1");
  const both = upsertDraft(first, { ...input, title: "二" }, "d2", "t2");
  assert.deepEqual(both.map((d) => d.id), ["d2", "d1"]);
  const updated: SavedDraft[] = upsertDraft(both, { ...input, title: "改过" }, "d1", "t3");
  assert.deepEqual(updated.map((d) => d.id), ["d1", "d2"]);
  assert.equal(updated[0].title, "改过");
  assert.equal(updated[0].createdAt, "t1");
  assert.equal(updated[0].updatedAt, "t3");
});

test("snapshot key detects edits and ignores override key order", () => {
  const a = { ...BLANK_SNAPSHOT, title: "x", overrides: { douyin: { enabled: true }, weibo: { enabled: false } } };
  const b = { ...BLANK_SNAPSHOT, title: "x", overrides: { weibo: { enabled: false }, douyin: { enabled: true } } };
  assert.equal(snapshotKey(a), snapshotKey(b));
  assert.notEqual(snapshotKey(a), snapshotKey({ ...a, topics: ["新"] }));
  assert.notEqual(snapshotKey(BLANK_SNAPSHOT), snapshotKey({ ...BLANK_SNAPSHOT, media: ["a.jpg"] }));
});

test("draft label falls back to body text then a placeholder", () => {
  assert.equal(draftLabel({ title: " 标题 ", description: "" }), "标题");
  assert.equal(draftLabel({ title: "", description: "这是一段很长很长很长很长很长很长的正文内容" }), "这是一段很长很长很长很长很长很长的正文内");
  assert.equal(draftLabel({ title: "", description: "" }), "未命名草稿");
});
