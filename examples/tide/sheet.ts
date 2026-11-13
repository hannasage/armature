/**
 * A bottom sheet built on the Tide flavor. It uses four controllers: a follower, a drag, a timeline, and the layout controllers.
 * Each environment is optional and defaults to the real browser. A test passes fakes.
 */
import type { ArmatureEnvironment, ArmatureTarget } from "@hannasage/armature";
import { createFollower } from "@hannasage/armature/dom";
import { createDrag, type ArmaturePointerEnvironment } from "@hannasage/armature/gesture";
import { createLayout, createPresence, createShared, type Layout, type LayoutEnvironment } from "@hannasage/armature/layout";
import { createBrowserTimelineEnvironment, createTimeline, type TimelineEnvironment } from "@hannasage/armature/timeline";
import { tide } from "./flavor";

export interface SheetParts {
  /** The sheet itself. It is dragged on y, and it leaves through presence. */
  sheet: ArmatureTarget;
  /** The layer behind the sheet. It gets `--tide-dim`. */
  backdrop: ArmatureTarget;
  /** The parent the sheet is removed from when it closes. */
  page: ArmatureTarget;
  /** The rows of the sheet, in order. */
  rows: readonly ArmatureTarget[];
  /** How far the sheet travels from open to closed, in pixels. */
  height: number;
}

export interface SheetEnvironments {
  page?: ArmatureEnvironment;
  pointer?: ArmaturePointerEnvironment;
  timeline?: TimelineEnvironment;
  layout?: LayoutEnvironment;
}

export interface Sheet {
  /** Dims the page and plays the rows in, one after another. */
  open(): void;
  /** Clears the dim and slides the sheet out. It is removed from the page when it rests. */
  close(): void;
  /** Runs `change`, which moves the rows, and glides each row from its old place to its new one. */
  reorder(change: () => void): void;
  /** Moves `to` from the place of `from`, as one element. Returns the layout of `to`. */
  expand(key: string, from: ArmatureTarget, to: ArmatureTarget): Layout;
  /** What moves now, for a test or a debug panel. */
  getState(): SheetState;
  destroy(): void;
}

export interface SheetState {
  closed: boolean;
  /** True while the dim springs. */
  dimming: boolean;
  /** True while a finger holds the sheet, or the sheet travels after a release. */
  dragging: boolean;
  /** True while the rows play in. */
  playing: boolean;
  /** How many rows still glide to a new place. */
  gliding: number;
  /** How many elements still slide out before they are removed. */
  exiting: number;
}

/** The time between the start of one row and the start of the next, in milliseconds. */
export const ROW_STAGGER = 40;

export function createSheet(parts: SheetParts, envs: SheetEnvironments = {}): Sheet {
  const { sheet, backdrop, page, rows, height } = parts;
  const dim = createFollower(backdrop, { flavor: tide, name: "dim", env: envs.page });
  const drag = createDrag(sheet, { flavor: tide, axis: "y", bounds: [0, height], snap: [0, height / 2, height], env: envs.pointer });
  const presence = createPresence(page, { flavor: tide, env: envs.layout });
  const shared = createShared({ flavor: tide, env: envs.layout });
  const layouts = rows.map((row) => createLayout(row, { flavor: tide, env: envs.layout }));
  const enter = createTimeline(envs.timeline ?? createBrowserTimelineEnvironment(), {
    flavor: tide,
    tracks: rows.flatMap((row, i) => [
      { target: row, value: "opacity", sequence: "rise", offset: i * ROW_STAGGER },
      { target: row, value: "translate", sequence: "settle-in", offset: i * ROW_STAGGER, format: (y: number) => `0px ${y}px` },
    ]),
  });
  let closed = false;
  const stopSwipe = drag.onSwipe((direction) => {
    if (direction === "down") close();
  });

  function close() {
    if (closed) return;
    closed = true;
    stopSwipe();
    dim.setTarget(0);
    const { y } = drag.getState();
    drag.destroy();
    presence.exit(sheet, { from: [0, y], to: { y: height - y, scale: 1 } });
  }

  return {
    open() {
      dim.setTarget(1);
      enter.seek(0);
      enter.play();
    },
    close,
    reorder(change) {
      for (const layout of layouts) layout.snapshot();
      change();
      for (const layout of layouts) layout.play();
    },
    expand(key, from, to) {
      shared.leave(key, from);
      return shared.enter(key, to);
    },
    getState() {
      const motion = drag.getState();
      const fade = dim.getState();
      return {
        closed,
        dimming: fade.moving && !fade.destroyed,
        dragging: motion.dragging || motion.moving,
        playing: enter.getState().playing,
        gliding: layouts.filter((layout) => layout.getState().moving).length,
        exiting: presence.getState().exiting,
      };
    },
    destroy() {
      stopSwipe();
      for (const controller of [dim, drag, enter, presence, shared, ...layouts]) controller.destroy();
    },
  };
}
