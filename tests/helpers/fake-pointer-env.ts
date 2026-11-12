import type { ArmatureTarget } from "../../src/engine/env";
import type { ArmaturePointerEnvironment, PointerHandlers } from "../../src/gesture/pointer-env";

/** A page stand-in for the gesture controllers: a manual clock, a manual frame queue, scripted pointer events, and a record of every write. */
export class FakePointerEnv implements ArmaturePointerEnvironment {
  time = 0;
  reduced = false;
  nextId = 1;
  frames = new Map<number, (time: number) => void>();
  requested = 0;
  cancelled: number[] = [];
  handlers = new Map<ArmatureTarget, PointerHandlers>();
  added = 0;
  removed = 0;
  writes: Array<{ target: ArmatureTarget; property: string; value: string | null }> = [];
  styles = new Map<ArmatureTarget, Record<string, string>>();
  /** When set, `setStyle` throws it. With `failProperty` set, only a write of that property throws. */
  failWith: Error | undefined;
  failProperty: string | undefined;

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
    if (this.failWith && (this.failProperty === undefined || this.failProperty === property)) throw this.failWith;
    this.writes.push({ target, property, value });
    const next = { ...(this.styles.get(target) ?? {}) };
    if (value === null) delete next[property];
    else next[property] = value;
    this.styles.set(target, next);
  };
  getStyle = (target: ArmatureTarget, property: string) => this.styles.get(target)?.[property] ?? null;
  onPointer = (target: ArmatureTarget, handlers: PointerHandlers) => {
    this.handlers.set(target, handlers);
    this.added += 1;
    return () => {
      this.handlers.delete(target);
      this.removed += 1;
    };
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

  /** Runs frames until none is pending or `limit` frames pass. Returns how many ran. */
  settle(ms = 1000 / 60, limit = 4000) {
    let ran = 0;
    while (this.pending > 0 && ran < limit) {
      this.tick(ms);
      ran += 1;
    }
    return ran;
  }

  read(target: ArmatureTarget, property = "translate") {
    return this.styles.get(target)?.[property];
  }
  writesTo(property: string) {
    return this.writes.filter((write) => write.property === property).map((write) => write.value);
  }

  down(target: ArmatureTarget, x: number, y: number, id = 1) { this.handlers.get(target)?.down({ id, x, y, time: this.time }); }
  move(target: ArmatureTarget, x: number, y: number, id = 1) { this.handlers.get(target)?.move({ id, x, y, time: this.time }); }
  up(target: ArmatureTarget, x: number, y: number, id = 1) { this.handlers.get(target)?.up({ id, x, y, time: this.time }); }
  cancel(target: ArmatureTarget, x: number, y: number, id = 1) { this.handlers.get(target)?.cancel({ id, x, y, time: this.time }); }

  /**
   * A scripted straight drag from `from` to `to` over `ms` milliseconds, with one move every `step` ms, ending with a move at `to`.
   * It starts with a down. It does not release. A release afterward is at the clock time of the last move.
   */
  press(target: ArmatureTarget, from: [number, number], to: [number, number], ms: number, step = 8) {
    this.down(target, from[0], from[1]);
    const count = Math.round(ms / step);
    for (let i = 1; i <= count; i++) {
      this.time += step;
      this.move(target, from[0] + ((to[0] - from[0]) * i) / count, from[1] + ((to[1] - from[1]) * i) / count);
    }
  }
}
