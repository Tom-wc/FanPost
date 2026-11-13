import assert from "node:assert/strict";
import test from "node:test";
import { missedSchedules, nextDueDraft, scheduledAtOf, upcomingSchedules } from "./schedule.ts";

const NOW = Date.parse("2026-11-13T12:00:00Z");
const draft = (id: string, at?: string) => ({ id, title: id, type: "image_text" as const, description: "", topics: [], mediaPaths: [], accountIds: [], createdAt: "", ...(at ? { scheduledAt: at } : {}) });
const task = (draftId: string, status: "pending" | "success" = "pending") => ({ draftId, status });

test("到点且还有未发任务的才触发，最早的先跑", () => {
  const drafts = [draft("a", "2026-11-13T13:00:00Z"), draft("b", "2026-11-13T11:00:00Z"), draft("c")];
  const tasks = [task("a"), task("b"), task("c")];
  assert.equal(nextDueDraft(drafts, tasks, NOW)?.id, "b");
  assert.equal(nextDueDraft(drafts, tasks, NOW - 2 * 3600000)?.id, undefined);
});

test("全部已发完的定时不再触发", () => {
  const drafts = [draft("a", "2026-11-13T11:00:00Z")];
  assert.equal(nextDueDraft(drafts, [task("a", "success")], NOW), undefined);
});

test("错过的时间点列出来，带待发条数，按时间排", () => {
  const drafts = [draft("a", "2026-11-13T13:00:00Z"), draft("b", "2026-11-13T11:00:00Z"), draft("c", "2026-11-13T10:00:00Z")];
  const tasks = [task("a"), task("b"), task("b"), task("c", "success")];
  const missed = missedSchedules(drafts, tasks, NOW);
  assert.deepEqual(missed.map((m) => m.id), ["b"]);
  assert.equal(missed[0]!.pending, 2);
  assert.deepEqual(upcomingSchedules(drafts, tasks, NOW).map((d) => d.id), ["a"]);
});

test("定时时间只接受合理范围，坏了不存", () => {
  assert.equal(scheduledAtOf("不是时间"), undefined);
  assert.equal(scheduledAtOf("2020-01-01T00:00:00Z"), undefined);
  const ok = new Date(Date.now() + 3600000).toISOString();
  assert.equal(scheduledAtOf(ok), ok);
  assert.equal(scheduledAtOf(new Date(Date.now() + 40 * 86400000).toISOString()), undefined);
});
