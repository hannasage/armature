import type { ArmatureTarget } from "../../src/engine/env";
import type { Box, LayoutEnvironment } from "../../src/layout";

/** The numbers of a style such as "12px 3px" or "0.5". One number fills the second place with `same` or with 0. */
function pair(text: string | undefined, fallback: [number, number], same: boolean): [number, number] {
  if (text === undefined) return fallback;
  const parts = text.trim().split(/\s+/).map(parseFloat);
  return [parts[0], parts[1] ?? (same ? parts[0] : 0)];
}

/**
 * A page stand-in for the layout controllers: a manual clock, a manual frame queue, a record of every write, and a small layout engine.
 * A test places the natural box of a target. `measure` gives that box moved and scaled by the `translate` and `scale` last written to the
 * target, about its center, as a browser does. A test can also script the boxes `measure` returns, which are used first.
 */
export class FakeLayoutEnv implements LayoutEnvironment {
  time = 0;
  reduced = false;
  nextId = 1;
  frames = new Map<number, (time: number) => void>();
  requested = 0;
  cancelled: number[] = [];
  writes: Array<{ target: ArmatureTarget; property: string; value: string | null }> = [];
  styles = new Map<ArmatureTarget, Record<string, string>>();
  natural = new Map<ArmatureTarget, Box>();
  scripted = new Map<ArmatureTarget, Box[]>();
  measured: ArmatureTarget[] = [];
  unmounted: Array<{ container: ArmatureTarget; target: ArmatureTarget; time: number }> = [];
  /** When set, `setStyle` throws it. */
  failWith: unknown;
  /** When set, `measure` throws it. */
  measureFails: unknown;
  /** When set, `unmount` throws it. */
  unmountFails: unknown;

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
    if (this.failWith !== undefined) throw this.failWith;
    this.writes.push({ target, property, value });
    const next = { ...(this.styles.get(target) ?? {}) };
    if (value === null) delete next[property];
    else next[property] = value;
    this.styles.set(target, next);
  };
  measure = (target: ArmatureTarget): Box => {
    this.measured.push(target);
    if (this.measureFails !== undefined) throw this.measureFails;
    const queue = this.scripted.get(target);
    if (queue && queue.length > 0) return queue.shift()!;
    return this.visual(target);
  };
  unmount = (container: ArmatureTarget, target: ArmatureTarget) => {
    if (this.unmountFails !== undefined) throw this.unmountFails;
    this.unmounted.push({ container, target, time: this.time });
  };

  /** Sets the natural box of a target: where layout puts it with no `translate` and no `scale`. */
  place(target: ArmatureTarget, box: Box) {
    this.natural.set(target, box);
  }
  /** Queues boxes for the next calls of `measure` on a target. */
  script(target: ArmatureTarget, ...boxes: Box[]) {
    this.scripted.set(target, [...(this.scripted.get(target) ?? []), ...boxes]);
  }
  /** The style written to a target now, or undefined when none is set. */
  style(target: ArmatureTarget, property: string) {
    return this.styles.get(target)?.[property];
  }
  /** The box a browser would show: the natural box with `translate` and `scale` applied about its center. */
  visual(target: ArmatureTarget): Box {
    const n = this.natural.get(target);
    if (!n) throw new Error("FakeLayoutEnv: no box was placed for this target");
    const [tx, ty] = pair(this.style(target, "translate"), [0, 0], false);
    const [sx, sy] = pair(this.style(target, "scale"), [1, 1], true);
    const width = n.width * sx;
    const height = n.height * sy;
    return { x: n.x + n.width / 2 + tx - width / 2, y: n.y + n.height / 2 + ty - height / 2, width, height };
  }
  /** The numbers written as `translate` and as `scale` now. */
  offsetOf(target: ArmatureTarget) {
    return { translate: pair(this.style(target, "translate"), [0, 0], false), scale: pair(this.style(target, "scale"), [1, 1], true) };
  }

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
  /** The properties written, with no repeats. */
  get properties() {
    return [...new Set(this.writes.map((write) => write.property))].sort();
  }
}

export const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });
