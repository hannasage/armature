/**
 * Shared elements: two elements with the same key, one leaving and one entering, animate as one. `leave` measures the element that goes, and
 * `enter` puts the element that comes on that box and springs it to its own place. The pair is matched by key. The leaving element is not
 * written to, so the caller removes or hides it in the same change. The layouts it makes run on one scheduler.
 */
import type { ArmatureTarget } from "../engine/env";
import type { Flavor } from "../engine/flavor";
import type { Scheduler } from "../frame/scheduler";
import type { Box, LayoutEnvironment } from "./env";
import { createLayout, type Layout, type LayoutOptions } from "./layout";
import { measure, setup, type Pose } from "./motion";
import { finite, thing } from "./util";

export interface SharedOptions {
  /** The numbers to use. Required. It needs a layout part. */
  flavor: Flavor;
  /** Defaults to the real browser. A test passes a fake. */
  env?: LayoutEnvironment;
  /** Shared by several controllers. Default: one of its own, which `destroy` also destroys. */
  scheduler?: Pick<Scheduler, "add">;
  /** Passed to every layout this makes. See `LayoutOptions.children`. */
  children?: LayoutOptions["children"];
}

export interface SharedState {
  /** How many keys have a leaving element and no entering one yet. */
  pending: number;
  destroyed: boolean;
}

export interface Shared {
  /**
   * Measures `element` as it shows now, and keeps the box under `key`. A later leave with the same key replaces it. When `element` was made
   * by `enter` and still moves, the speed it has goes to the next element too.
   */
  leave(key: string | number, element: ArmatureTarget): void;
  /**
   * Returns the layout of `element`. When `key` has a leaving element, the layout starts from its box with its speed, and moves to the place of
   * `element` at once. A key is used once. Without a leaving element the layout is at rest.
   */
  enter(key: string | number, element: ArmatureTarget): Layout;
  /** Forgets the leaving element of `key`. */
  cancel(key: string | number): void;
  getState(): SharedState;
  /** Stops every layout it made, and forgets every key. It logs nothing. Safe to call twice. */
  destroy(): void;
}

const keyOf = (key: unknown): string | number => {
  if ((typeof key === "string" && key !== "") || finite(key)) return key;
  throw new TypeError("A shared key is a text that is not empty, or a finite number.");
};

export function createShared(options: SharedOptions): Shared {
  const { env, own, scheduler, tag } = setup(options, "shared element");
  const made = new Set<Layout>();
  const byElement = new WeakMap<object, Layout>();
  const waiting = new Map<string | number, { box: Box; speed: Pose | undefined }>();
  let destroyed = false;
  let warned = false;

  const layoutFor = (element: ArmatureTarget) => {
    const layout = createLayout(element, { flavor: options.flavor, env, scheduler, children: options.children });
    const done = layout.destroy;
    layout.destroy = () => {
      made.delete(layout);
      done();
    };
    return layout;
  };

  return {
    leave(key, element) {
      if (destroyed) return;
      const name = keyOf(key);
      if (!thing(element)) throw new TypeError("A shared element is an element.");
      try {
        const owner = byElement.get(element);
        const speed = owner?.getState().velocity;
        waiting.set(name, { box: measure(env, element), speed });
        // The element goes away, so its own layout has nothing left to do.
        owner?.destroy();
        byElement.delete(element);
      } catch (error) {
        if (!warned) console.error(`${tag} A shared element could not be measured.`, error);
        warned = true;
      }
    },
    enter(key, element) {
      const name = keyOf(key);
      if (!thing(element)) throw new TypeError("A shared element is an element.");
      const layout = layoutFor(element);
      if (destroyed) {
        layout.destroy();
        return layout;
      }
      made.add(layout);
      byElement.set(element, layout);
      const from = waiting.get(name);
      waiting.delete(name);
      if (from) {
        layout.snapshot(from.box, from.speed);
        layout.play();
      }
      return layout;
    },
    cancel(key) {
      const name = keyOf(key);
      if (!destroyed) waiting.delete(name);
    },
    getState: () => ({ pending: waiting.size, destroyed }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      waiting.clear();
      for (const layout of [...made]) layout.destroy();
      if (own) (scheduler as Scheduler).destroy();
    },
  };
}
