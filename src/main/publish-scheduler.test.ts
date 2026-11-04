import test from "node:test";
import assert from "node:assert/strict";
import type { Platform } from "../shared/types";
import { runScheduled, START_STAGGER_MS, type SchedulerHooks } from "./publish-scheduler.ts";

type Task = { id: string; platform: Platform };
const t = (id: string, platform: Platform): Task => ({ id, platform });

function harness(durations: Record<string, number>, opts: { limit?: number; gapMs?: number; stopAt?: number } = {}) {
  let now = 0;
  const timers: Array<{ at: number; resolve: () => void }> = [];
  const sleepUntil = (at: number) => new Promise<void>((resolve) => timers.push({ at, resolve }));
  const starts: Record<string, number> = {};
  let active = 0;
  let maxActive = 0;
  const hooks: SchedulerHooks<Task> = {
    limit: () => opts.limit ?? 3,
    samePlatformGapMs: () => opts.gapMs ?? 0,
    now: () => now,
    wait: async (_task, ms) => {
      if (opts.stopAt !== undefined && now >= opts.stopAt) return false;
      if (ms > 0) await sleepUntil(now + ms);
      return !(opts.stopAt !== undefined && now >= opts.stopAt);
    },
    run: async (task) => {
      starts[task.id] = now;
      active++;
      maxActive = Math.max(maxActive, active);
      await sleepUntil(now + (durations[task.id] ?? 1000));
      active--;
    },
  };
  const drive = async (done: Promise<unknown>) => {
    let finished = false;
    void done.finally(() => (finished = true));
    while (!finished) {
      for (let i = 0; i < 20; i++) await Promise.resolve();
      if (finished) break;
      timers.sort((a, b) => a.at - b.at);
      const next = timers.shift();
      if (!next) continue;
      now = Math.max(now, next.at);
      next.resolve();
    }
  };
  return { hooks, starts, drive, get maxActive() { return maxActive; } };
}

test("不同平台同时填写，开始时间只错开几秒", async () => {
  const h = harness({ d: 60000, k: 60000, z: 60000 });
  const p = runScheduled([t("d", "douyin"), t("k", "kuaishou"), t("z", "zhihu")], h.hooks);
  await h.drive(p);
  assert.deepEqual(await p, []);
  assert.deepEqual(Object.values(h.starts).sort((a, b) => a - b), [0, START_STAGGER_MS, 2 * START_STAGGER_MS]);
});

test("同时填写的账号数不超过上限", async () => {
  const ids = ["douyin", "kuaishou", "zhihu", "toutiao", "baijiahao"] as Platform[];
  const h = harness(Object.fromEntries(ids.map((p) => [p, 30000])), { limit: 2 });
  const p = runScheduled(ids.map((p) => t(p, p)), h.hooks);
  await h.drive(p);
  assert.equal(h.maxActive, 2);
  assert.equal(Object.keys(h.starts).length, 5);
});

test("同平台多账号依次填写，并错开设定的时间", async () => {
  const h = harness({ x1: 30000, x2: 30000, d: 30000 }, { gapMs: 600000 });
  const p = runScheduled([t("x1", "xiaohongshu"), t("x2", "xiaohongshu"), t("d", "douyin")], h.hooks);
  await h.drive(p);
  assert.equal(h.starts.x1, 0);
  assert.equal(h.starts.d, START_STAGGER_MS);
  assert.equal(h.starts.x2, 600000);
});

test("多个平台各有多个账号：平台之间同时填，每个平台内部依次错开", async () => {
  const platforms = ["douyin", "kuaishou", "toutiao", "zhihu", "baijiahao", "weibo"] as Platform[];
  const tasks = platforms.flatMap((p) => [t(p + "1", p), t(p + "2", p), t(p + "3", p)]);
  const h = harness(Object.fromEntries(tasks.map((x) => [x.id, 30000])), { limit: 4, gapMs: 600000 });
  const p = runScheduled(tasks, h.hooks);
  await h.drive(p);
  assert.deepEqual(await p, []);
  assert.equal(Object.keys(h.starts).length, tasks.length);
  assert.ok(h.maxActive <= 4);
  for (const platform of platforms) {
    const [a, b, c] = [1, 2, 3].map((n) => h.starts[platform + n]);
    assert.ok(b - a >= 600000 && c - b >= 600000, platform + " 同平台账号间隔不足");
  }
  const firsts = platforms.map((x) => h.starts[x + "1"]).sort((a, b) => a - b);
  assert.ok(firsts.at(-1)! < 600000, "首轮被同平台间隔拖慢：" + firsts.join(","));
});

test("填写耗时超过错开时间时，同平台下一个账号等上一个填完再开始", async () => {
  const h = harness({ x1: 90000, x2: 1000 }, { gapMs: 60000 });
  const p = runScheduled([t("x1", "xiaohongshu"), t("x2", "xiaohongshu")], h.hooks);
  await h.drive(p);
  assert.equal(h.starts.x2, 90000);
});

test("停止后返回没开始的任务", async () => {
  const h = harness({ x1: 1000, x2: 1000, d: 1000 }, { gapMs: 600000, stopAt: 5000 });
  const p = runScheduled([t("x1", "xiaohongshu"), t("x2", "xiaohongshu"), t("d", "douyin")], h.hooks);
  await h.drive(p);
  assert.deepEqual((await p).map((x) => x.id), ["x2"]);
});
