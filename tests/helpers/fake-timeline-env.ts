import type { ArmatureTarget } from "../../src/engine/env";
import type { TimelineEnvironment } from "../../src/timeline/timeline";

/** A page stand-in for the timeline: a manual clock, a manual frame queue, and a record of every write. */
export class FakeTimelineEnv implements TimelineEnvironment {
  time = 0;
  reduced = false;
  nextId = 1;
  frames = new Map<number, (time: number) => void>();
  requested = 0;
  cancelled: number[] = [];
  writes: Array<{ target: ArmatureTarget; property: string; value: string | null }> = [];
  /** When set, `setStyle` throws it. */
  failWith: Error | undefined;

  requestFrame = (callback: (time: number) => void) => {
    const id = this.nextId++;
    this.requested += 1;
    this.frames.set(id, callback);
    return id;
  };
  cancelFrame = (id: number) => {
    this.cancelled.push(id);
    this.frames.delete(id);
  };
  now = () => this.time;
  matchMedia = (query: string) => ({ matches: query.includes("prefers-reduced-motion") && this.reduced });
  setStyle = (target: ArmatureTarget, property: string, value: string | null) => {
    if (this.failWith) throw this.failWith;
    this.writes.push({ target, property, value });
  };

  get pending() {
    return this.frames.size;
  }

  /** Runs one frame: advances the clock, then runs the callbacks that were queued before it. */
  tick(ms = 1000 / 60) {
    this.time += ms;
    const callbacks = [...this.frames.values()];
    this.frames.clear();
    for (const callback of callbacks) callback(this.time);
  }

  /** Runs frames of `ms` each until `total` milliseconds have passed or no frame is pending. Returns how many ran. */
  run(total: number, ms = 1000 / 60) {
    const end = this.time + total;
    let ran = 0;
    while (this.pending > 0 && this.time < end - 1e-9) {
      this.tick(Math.min(ms, end - this.time));
      ran += 1;
    }
    return ran;
  }

  /** The values written to one property of one target, in order. */
  valuesOf(target: ArmatureTarget, property: string) {
    return this.writes.filter((write) => write.target === target && write.property === property).map((write) => write.value);
  }
}
