/**
 * Shared elements: two elements with the same key, one leaving and one entering, animate as one. `leave` measures the element that goes, and
 * `enter` puts the element that comes on that box and springs it to its own place. The pair is matched by key. The leaving element is never
 * written to, so the caller removes or hides it in the same change. The layouts it makes run on one scheduler.
 * A key that waits is dropped after `ttl` milliseconds on the clock of the environment, and the caller can `cancel` it sooner.
 * A layout is tracked only while it moves. When it rests, it belongs to the caller.
 */
import type { ArmatureTarget } from "../engine/env";
import type { Flavor } from "../engine/flavor";
import type { Scheduler } from "../frame/scheduler";
import type { Box, LayoutEnvironment } from "./env";
import { createLayout, type Layout, type LayoutOptions } from "./layout";
import { empty, measure, noBox, setup, type Pose } from "./motion";
import { finite, thing, toError } from "./util";

export interface SharedOptions {
  /** The numbers to use. Required. It needs a layout part. */
  flavor: Flavor;
  /** Defaults to the real browser. A test passes a fake. */
  env?: LayoutEnvironment;
  /** Shared by several controllers. Default: one of its own, which `destroy` also destroys. */
  scheduler?: Pick<Scheduler, "add">;
  /** Passed to every layout this makes. See `LayoutOptions.children`. */
  children?: LayoutOptions["children"];
  /** Milliseconds a leaving box waits for its entering element. A finite number above 0. Default 2000. */
  ttl?: number;
}

export interface SharedState {
  /** How many keys have a leaving element and no entering one yet. Expired keys are not counted. */
  pending: number;
  /** How many layouts it tracks: the ones that still move. */
  layouts: number;
  destroyed: boolean;
  /** The last error of a leave that could not measure. */
  failed?: Error;
}

export interface Shared {
  /**
   * Measures `element` as it shows now, and keeps the box under `key`. A later leave with the same key replaces it, and a leave that fails
   * removes it. When `element` was made by `enter` and still moves, the speed it has goes to the next element, and its layout is released.
   */
  leave(key: string | number, element: ArmatureTarget): void;
  /**
   * Returns the layout of `element`. When `key` has a leaving element, the layout starts from its box with its speed, and moves to the place of
   * `element` at once, and a layout that still moves on `element` is destroyed first. A key is used once. Without a leaving element, a layout
   * that moves on `element` is returned as it is, and any other is at rest.
   */
  enter(key: string | number, element: ArmatureTarget): Layout;
  /** Forgets the leaving element of `key`. */
  cancel(key: string | number): void;
  getState(): SharedState;
  /** Stops every layout it tracks, and forgets every key. It logs nothing. Safe to call twice. */
  destroy(): void;
}

const keyOf = (key: unknown): string | number => {
  if ((typeof key === "string" && key !== "") || finite(key)) return key;
  throw new TypeError("A shared key is a text that is not empty, or a finite number.");
};

export function createShared(options: SharedOptions): Shared {
  const { env, own, scheduler, tag } = setup(options, "shared element");
  const ttl = options.ttl ?? 2000;
  if (!finite(ttl) || ttl <= 0) throw new TypeError("The ttl of a shared element is a finite number of milliseconds above 0.");
  const made = new Set<Layout>();
  const byElement = new Map<object, Layout>();
  const waiting = new Map<string | number, { box: Box; speed: Pose | undefined; at: number }>();
  const seen = new Set<string>();
  let destroyed = false;
  let failure: Error | undefined;

  const warn = (text: string, error: unknown) => {
    if (!seen.has(text)) console.error(`${tag} ${text}`, error);
    seen.add(text);
  };
  /** Drops the keys that waited longer than the ttl. */
  const prune = () => {
    if (waiting.size === 0) return;
    const now = env.now();
    for (const [key, entry] of [...waiting]) if (now - entry.at > ttl) waiting.delete(key);
  };
  const untrack = (layout: Layout, element: object) => {
    made.delete(layout);
    if (byElement.get(element) === layout) byElement.delete(element);
  };

  return {
    leave(key, element) {
      if (destroyed) return;
      const name = keyOf(key);
      if (!thing(element)) throw new TypeError("A shared element is an element.");
      prune();
      // A leave that fails leaves no stale key from an earlier one.
      waiting.delete(name);
      try {
        const owner = byElement.get(element);
        const speed = owner?.getState().velocity;
        const box = measure(env, element);
        if (empty(box)) {
          if (!seen.has("")) noBox(tag, "the key");
          seen.add("");
          return;
        }
        waiting.set(name, { box, speed, at: env.now() });
        if (owner) {
          // The element goes away, and it is not written to: its layout stops where it is.
          untrack(owner, element);
          owner.release();
        }
      } catch (error) {
        failure = toError(error);
        warn(`A shared element could not be measured: ${failure.message}`, error);
      }
    },
    enter(key, element) {
      const name = keyOf(key);
      if (!thing(element)) throw new TypeError("A shared element is an element.");
      prune();
      const from = waiting.get(name);
      waiting.delete(name);
      const live = byElement.get(element);
      if (live && !from && !destroyed) return live;
      live?.destroy();
      const layout = createLayout(element, { flavor: options.flavor, env, scheduler, children: options.children });
      if (destroyed) {
        layout.destroy();
        return layout;
      }
      if (from) {
        layout.snapshot(from.box, from.speed);
        layout.play();
        if (layout.getState().moving) {
          made.add(layout);
          byElement.set(element, layout);
          layout.on("rest", () => untrack(layout, element));
          const done = layout.destroy;
          layout.destroy = () => {
            untrack(layout, element);
            done();
          };
        }
      }
      return layout;
    },
    cancel(key) {
      const name = keyOf(key);
      if (!destroyed) waiting.delete(name);
    },
    getState: () => {
      prune();
      return { pending: waiting.size, layouts: made.size, destroyed, failed: failure };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      waiting.clear();
      for (const layout of [...made]) layout.destroy();
      made.clear();
      byElement.clear();
      if (own) (scheduler as Scheduler).destroy();
    },
  };
}
