export type BatchState = "idle" | "running" | "paused" | "stopping";

const TICK_MS = 250;

export class PublishControl {
  private state: BatchState = "idle";
  private readonly onChange: (state: BatchState) => void;
  constructor(onChange: (state: BatchState) => void = () => {}) {
    this.onChange = onChange;
  }

  get current(): BatchState {
    return this.state;
  }

  private set(next: BatchState) {
    if (next === this.state) return;
    this.state = next;
    this.onChange(next);
  }

  start() {
    this.set("running");
  }

  finish() {
    this.set("idle");
  }

  pause() {
    if (this.state === "running") this.set("paused");
    return this.state;
  }

  resume() {
    if (this.state === "paused") this.set("running");
    return this.state;
  }

  stop() {
    if (this.state === "running" || this.state === "paused") this.set("stopping");
    return this.state;
  }

  get stopped() {
    return this.state === "stopping";
  }

  async wait(ms: number, sleep: (ms: number) => Promise<void>, onPause?: () => Promise<void>, onResume?: () => Promise<void>): Promise<boolean> {
    let left = ms;
    let notified = false;
    while (!this.stopped) {
      if (this.state === "paused") {
        if (!notified && onPause) await onPause();
        notified = true;
        await sleep(TICK_MS);
        continue;
      }
      if (notified && onResume && left > 0) await onResume();
      notified = false;
      if (left <= 0) return true;
      const step = Math.min(TICK_MS, left);
      await sleep(step);
      left -= step;
    }
    return false;
  }
}
