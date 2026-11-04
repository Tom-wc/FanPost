import type { Platform } from "../shared/types";
import { groupByPlatform } from "../shared/accounts.ts";

export const START_STAGGER_MS = 2000;
const SLOT_POLL_MS = 500;

export type WaitReason = "same-platform" | "slot" | "start";

export interface SchedulerHooks<T> {
  limit: () => number;
  samePlatformGapMs: () => number;
  now: () => number;
  wait: (task: T, ms: number, reason: WaitReason) => Promise<boolean>;
  run: (task: T) => Promise<void>;
}

export async function runScheduled<T extends { platform: Platform }>(tasks: T[], hooks: SchedulerHooks<T>): Promise<T[]> {
  let active = 0;
  let lastStart = Number.NEGATIVE_INFINITY;

  const tryReserve = () => {
    if (active >= hooks.limit() || hooks.now() < lastStart + START_STAGGER_MS) return false;
    active++;
    lastStart = hooks.now();
    return true;
  };

  const takeSlot = async (task: T) => {
    for (;;) {
      if (!(await hooks.wait(task, 0, "start"))) return false;
      if (tryReserve()) return true;
      const stagger = lastStart + START_STAGGER_MS - hooks.now();
      const ms = active < hooks.limit() && stagger > 0 ? stagger : SLOT_POLL_MS;
      if (!(await hooks.wait(task, ms, "slot"))) return false;
    }
  };

  const runLane = async (lane: T[]): Promise<T[]> => {
    let laneStart: number | undefined;
    for (let i = 0; i < lane.length; i++) {
      const task = lane[i];
      if (laneStart !== undefined) {
        const left = laneStart + hooks.samePlatformGapMs() - hooks.now();
        if (left > 0 && !(await hooks.wait(task, left, "same-platform"))) return lane.slice(i);
      }
      if (!(await takeSlot(task))) return lane.slice(i);
      laneStart = hooks.now();
      try {
        await hooks.run(task);
      } finally {
        active--;
      }
    }
    return [];
  };

  const left = await Promise.all(groupByPlatform(tasks).map(runLane));
  return left.flat();
}
