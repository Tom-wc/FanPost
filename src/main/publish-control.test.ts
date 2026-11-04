import test from "node:test";
import assert from "node:assert/strict";
import { PublishControl, type BatchState } from "./publish-control.ts";

function fakeClock(onTick: (now: number) => void = () => {}) {
  let now = 0;
  return {
    get now() {
      return now;
    },
    sleep: async (ms: number) => {
      now += ms;
      onTick(now);
    },
  };
}

test("wait 跑满时长后返回 true", async () => {
  const c = new PublishControl();
  c.start();
  const clock = fakeClock();
  assert.equal(await c.wait(1000, clock.sleep), true);
  assert.equal(clock.now, 1000);
});

test("暂停期间不计时，继续后接着倒计时", async () => {
  const c = new PublishControl();
  c.start();
  let pausedTicks = 0;
  let pausedAt = -1;
  const clock = fakeClock((now) => {
    if (now === 500) {
      c.pause();
      pausedAt = now;
      return;
    }
    if (c.current === "paused" && ++pausedTicks === 4) c.resume();
  });
  let pauseNotices = 0;
  assert.equal(await c.wait(1000, clock.sleep, async () => void pauseNotices++), true);
  assert.equal(pausedAt, 500);
  assert.equal(clock.now, 500 + 4 * 250 + 500);
  assert.equal(pauseNotices, 1);
});

test("停止后 wait 立即返回 false，暂停中也能停止", async () => {
  const c = new PublishControl();
  c.start();
  const clock = fakeClock((now) => {
    if (now === 250) c.pause();
    if (now === 1000) c.stop();
  });
  assert.equal(await c.wait(60000, clock.sleep), false);
  assert.equal(c.current, "stopping");
});

test("状态切换只在合法时生效并通知", () => {
  const seen: BatchState[] = [];
  const c = new PublishControl((s) => seen.push(s));
  assert.equal(c.pause(), "idle");
  assert.equal(c.stop(), "idle");
  c.start();
  assert.equal(c.resume(), "running");
  assert.equal(c.pause(), "paused");
  assert.equal(c.pause(), "paused");
  assert.equal(c.resume(), "running");
  assert.equal(c.stop(), "stopping");
  c.finish();
  assert.deepEqual(seen, ["running", "paused", "running", "stopping", "idle"]);
});
