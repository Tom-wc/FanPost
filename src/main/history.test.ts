import assert from "node:assert/strict";
import test from "node:test";
import { expiredDraftIds, referencedFiles, withoutDrafts } from "../shared/history.ts";
import { normalizeSettings } from "../shared/accounts.ts";
import type { AppNotification, PublishDraft, PublishTask, TaskStatus } from "../shared/types.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-22T00:00:00Z");
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

const draft = (id: string, daysAgo: number, extra: Partial<PublishDraft> = {}): PublishDraft => ({
  id, type: "video", title: id, description: "", topics: [], mediaPaths: [], accountIds: [], createdAt: iso(daysAgo), ...extra,
});
const task = (id: string, draftId: string, status: TaskStatus, daysAgo: number, message = ""): PublishTask => ({
  id, draftId, accountId: "a", platform: "douyin", title: "", status, message, createdAt: iso(daysAgo), updatedAt: iso(daysAgo),
});
const note = (id: string, taskId?: string): AppNotification => ({
  id, level: "info", kind: "batch_done", title: "", message: "", createdAt: iso(0), read: false, ...(taskId ? { taskId } : {}),
});

const sample = () => ({
  drafts: [draft("old", 40), draft("mid", 10), draft("fresh", 2), draft("waiting", 40)],
  tasks: [
    task("t-old", "old", "success", 40),
    task("t-mid", "mid", "failed", 10),
    task("t-fresh", "fresh", "success", 2),
    task("t-wait", "waiting", "manual_required", 3),
  ],
});

test("forever keeps every record", () => {
  assert.deepEqual(expiredDraftIds(sample(), "forever", NOW), []);
});

test("day-based retention uses the latest task update, not draft creation", () => {
  assert.deepEqual(expiredDraftIds(sample(), "30d", NOW), ["old"]);
  assert.deepEqual(expiredDraftIds(sample(), "7d", NOW), ["old", "mid"]);
});

test("none clears finished batches but keeps ones still waiting for the user", () => {
  assert.deepEqual(expiredDraftIds(sample(), "none", NOW), ["old", "mid", "fresh"]);
  assert.deepEqual(expiredDraftIds(sample(), "none", NOW, ["fresh"]), ["old", "mid"]);
});


test("dismissed tasks count as finished, so 'none' retention can clear their batch", () => {
  const data = { drafts: [draft("d", 1)], tasks: [task("t1", "d", "dismissed", 1), task("t2", "d", "success", 1)] };
  assert.deepEqual(expiredDraftIds(data, "none", NOW), ["d"]);
  const waiting = { drafts: [draft("d", 1)], tasks: [task("t1", "d", "dismissed", 1), task("t2", "d", "manual_required", 1)] };
  assert.deepEqual(expiredDraftIds(waiting, "none", NOW), []);
});
test("removing drafts drops their tasks and linked notifications only", () => {
  const data = { ...sample(), notifications: [note("n1", "t-old"), note("n2", "old"), note("n3", "t-fresh"), note("n4")] };
  const next = withoutDrafts(data, ["old"]);
  assert.deepEqual(next.drafts.map((d) => d.id), ["mid", "fresh", "waiting"]);
  assert.deepEqual(next.tasks.map((t) => t.id), ["t-mid", "t-fresh", "t-wait"]);
  assert.deepEqual(next.notifications.map((n) => n.id), ["n3", "n4"]);
  assert.equal(withoutDrafts(data, []), data);
});

test("referenced files include covers, platform covers and failure screenshots", () => {
  const files = referencedFiles({
    drafts: [draft("d", 0, { coverPath: "C:/u/covers/a.jpg", overrides: { bilibili: { coverPath: "C:/u/covers/b.jpg" } } })],
    tasks: [
      task("t", "d", "failed", 0, "上传超时；现场截图：C:\\u\\task-artifacts\\douyin-1.png。发布窗口已保留"),
      { ...task("t2", "d", "manual_required", 0), snapshotPath: "C:\\u\\task-artifacts\\snap-t2.jpg" },
    ],
  });
  assert.deepEqual([...files].sort(), ["C:/u/covers/a.jpg", "C:/u/covers/b.jpg", "C:\\u\\task-artifacts\\cover-t2-l.jpg", "C:\\u\\task-artifacts\\cover-t2-p.jpg", "C:\\u\\task-artifacts\\cover-t2.jpg","C:\\u\\task-artifacts\\douyin-1.png", "C:\\u\\task-artifacts\\snap-t2.jpg"]);
});

test("history retention setting defaults to forever and rejects unknown values", () => {
  assert.equal(normalizeSettings(undefined).historyRetention, "forever");
  assert.equal(normalizeSettings({ historyRetention: "7d" }).historyRetention, "7d");
  assert.equal(normalizeSettings({ historyRetention: "1y" }).historyRetention, "forever");
});

test("covers used by saved drafts count as referenced so cleanup keeps them", () => {
  const saved = { id: "s", type: "video" as const, title: "", description: "", topics: [], mediaPaths: [], accountIds: [], overrides: {}, coverPath: "C:/data/covers/s.jpg", createdAt: iso(0), updatedAt: iso(0) };
  const files = referencedFiles({ drafts: [draft("d", 1, { coverPath: "C:/data/covers/d.jpg" })], tasks: [], savedDrafts: [saved] });
  assert.ok(files.has("C:/data/covers/s.jpg"));
  assert.ok(files.has("C:/data/covers/d.jpg"));
});
