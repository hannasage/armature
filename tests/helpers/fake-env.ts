import type { ArmatureEnvironment, ArmatureTarget } from "../../src/engine/env";

/** A browser stand-in: a manual clock, a manual frame queue, and a record of every write. */
export class FakeEnv implements ArmatureEnvironment {
  time = 0;
  /** How far `now()` runs ahead of the frame time a callback receives, as in a browser where a frame callback starts late in the frame. */
  lag = 0;
  reduced = false;
  nextId = 1;
  frames = new Map<number, (time: number) => void>();
  requested = 0;
  cancelled: number[] = [];
  writes: Array<{ target: ArmatureTarget; name: string; value: string }> = [];
  vars = new Map<ArmatureTarget, Record<string, string>>();
  attrs = new Map<ArmatureTarget, Record<string, string>>();
  resizeCallbacks = new Map<ArmatureTarget, () => void>();
  disconnected = 0;

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

  now = () => this.time + this.lag;

  matchMedia = (query: string) => ({ matches: query.includes("prefers-reduced-motion") && this.reduced });

  setCSSVariable = (target: ArmatureTarget, name: string, value: string) => {
    this.writes.push({ target, name, value });
    this.vars.set(target, { ...(this.vars.get(target) ?? {}), [name]: value });
  };

  setAttribute = (target: ArmatureTarget, name: string, value: string | null) => {
    const next = { ...(this.attrs.get(target) ?? {}) };
    if (value === null) delete next[name];
    else next[name] = value;
    this.attrs.set(target, next);
  };

  observeResize = (target: ArmatureTarget, callback: () => void) => {
    this.resizeCallbacks.set(target, callback);
    return { disconnect: () => { this.disconnected += 1; this.resizeCallbacks.delete(target); } };
  };

  /** Number of frame callbacks waiting. */
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
  settle(ms = 1000 / 60, limit = 2000) {
    let ran = 0;
    while (this.pending > 0 && ran < limit) {
      this.tick(ms);
      ran += 1;
    }
    return ran;
  }

  read(target: ArmatureTarget, name: string) {
    return this.vars.get(target)?.[name];
  }

  writesTo(name: string) {
    return this.writes.filter((write) => write.name === name);
  }
}
