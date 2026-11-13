import { describe, expect, it } from "vitest";
import { requireFollower, validateFlavor, type Flavor } from "@hannasage/armature";
import { cssFlavor, cssKeyframes } from "@hannasage/armature/css";
import { requireGesture } from "@hannasage/armature/gesture";
import { glassFlavor } from "@hannasage/armature/glass";
import { requireLayout } from "@hannasage/armature/layout";
import { projection } from "../../examples/projection/flavor";
import { tide } from "../../examples/tide/flavor";
import { createSheet, ROW_STAGGER } from "../../examples/tide/sheet";
import { createTimeline, requireTimeline } from "@hannasage/armature/timeline";
import { FIXED_STEP } from "../../src/engine/spring";
import { measureSpring } from "../helpers/measure-spring";
import { readDoc, sectionOf } from "../helpers/doc-pages";
import { FakeEnv } from "../helpers/fake-env";
import { box, FakeLayoutEnv } from "../helpers/fake-layout-env";
import { FakePointerEnv } from "../helpers/fake-pointer-env";
import { FakeTimelineEnv } from "../helpers/fake-timeline-env";
import { swipey } from "../helpers/gesture-flavor";
import { lofty } from "../helpers/layout-flavor";
import { tempo } from "../helpers/timeline-flavor";

// The third flavor, from the stamped Milestone 4. It is built on the public API only, with every part that amendment 1 added: a follower,
// a gesture, a timeline, and a layout. These tests run it through the controllers, not just through the checks, so a flavor that only
// validated would fail here.

const HEIGHT = 480;

function setup() {
  const sheet = { id: "sheet" };
  const backdrop = { id: "backdrop" };
  const page = { id: "page" };
  const rows = [{ id: "row-0" }, { id: "row-1" }, { id: "row-2" }];
  const envs = { page: new FakeEnv(), pointer: new FakePointerEnv(), timeline: new FakeTimelineEnv(), layout: new FakeLayoutEnv() };
  envs.layout.place(sheet, box(0, 320, 360, HEIGHT));
  rows.forEach((row, i) => envs.layout.place(row, box(0, 340 + i * 56, 360, 48)));
  const ui = createSheet({ sheet, backdrop, page, rows, height: HEIGHT }, envs);
  return { sheet, backdrop, page, rows, envs, ui };
}

const springs = (flavor: Flavor) => Object.values(flavor.springs).map((spring) => ({ mass: 1, ...spring }));

/** Every number and text at the leaves of a value, by its path. */
function leaves(value: unknown, path = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (value !== null && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) for (const [p, v] of leaves(inner, `${path}/${key}`)) out.set(p, v);
  } else out.set(path, value);
  return out;
}
/** How many leaves differ between two values, counting a leaf that only one of them has. */
function leafDiff(a: unknown, b: unknown): number {
  const [x, y] = [leaves(a), leaves(b)];
  return [...new Set([...x.keys(), ...y.keys()])].filter((key) => x.get(key) !== y.get(key)).length;
}

describe("the Tide flavor", () => {
  it("holds together, and has a follower, a gesture, a timeline, and a layout part", () => {
    expect(() => validateFlavor(tide)).not.toThrow();
    expect(requireFollower(tide, "dim").var).toBe("dim");
    expect(requireGesture(tide)).toBe(tide.gesture);
    expect(requireTimeline(tide)).toBe(tide.timeline);
    expect(requireLayout(tide)).toBe(tide.layout);
    expect(Object.isFrozen(tide.gesture)).toBe(true);
  });

  it("is its own flavor and not a copy of glass or Projection: another name, prefix, label, and set of springs", () => {
    for (const other of [glassFlavor, projection] as Flavor[]) {
      expect(tide.name).not.toBe(other.name);
      expect(tide.prefix).not.toBe(other.prefix);
      expect(tide.logLabel).not.toBe(other.logLabel);
      // No Tide spring shares both its stiffness and its damping with a spring of another flavor. One shared value is normal.
      for (const mine of springs(tide)) {
        for (const theirs of springs(other)) {
          expect(mine.stiffness === theirs.stiffness && mine.damping === theirs.damping, `${other.name} ${JSON.stringify(theirs)}`).toBe(false);
        }
      }
    }
  });

  it("differs from each test flavor and from Projection in at least two numbers of every shared part, so a copy with one change fails", () => {
    expect(leafDiff(tide.gesture, swipey.gesture)).toBeGreaterThanOrEqual(2);
    expect(leafDiff(tide.timeline, tempo.timeline)).toBeGreaterThanOrEqual(2);
    expect(leafDiff(tide.layout, lofty.layout)).toBeGreaterThanOrEqual(2);
    for (const follower of Object.values(projection.followers)) expect(leafDiff(tide.followers.dim, follower)).toBeGreaterThanOrEqual(2);
    // The measure itself: one changed number is one difference.
    expect(leafDiff(swipey.gesture, { ...swipey.gesture, friction: 5 })).toBe(1);
  });

  it("uses none of the parts that only glass and Projection carry", () => {
    expect(tide).not.toHaveProperty("surface");
    expect(tide).not.toHaveProperty("lens");
    expect(tide).not.toHaveProperty("reveal");
  });

  it("rings past the target on settle-in by the overshoot the guide measures for ripple, and comes back", () => {
    const env = new FakeTimelineEnv();
    const row = {};
    const tl = createTimeline(env, { flavor: tide, tracks: [{ target: row, value: "--y", sequence: "settle-in" }] });
    const values: number[] = [];
    const slice = FIXED_STEP * 1000;
    for (let at = 0; at <= tl.getState().duration; at += slice) {
      tl.seek(at);
      values.push(tl.getState().values[0]);
    }
    const start = tide.timeline.sequences!["settle-in"].keys[0][1];
    const overshoot = measureSpring(tide.springs.ripple).overshoot;
    expect(Math.min(...values)).toBeCloseTo(-start * overshoot, 6);
    expect(sectionOf(readDoc("flavor-authoring.md"), "ripple")).toContain(`- Measured overshoot: ${(overshoot * 100).toFixed(1)} percent.`);
    tl.seek(Infinity);
    expect(tl.getState().values[0]).toBe(0);
  });

  it("writes a stylesheet and keyframes through the CSS output", () => {
    expect(cssFlavor(tide)).toContain("@property --tide-dim { syntax: \"<number>\"; inherits: true; initial-value: 0; }");
    const css = cssKeyframes("tide-rise", { flavor: tide, tracks: [{ property: "opacity", sequence: "rise" }] });
    expect(css.startsWith("@keyframes tide-rise {")).toBe(true);
    expect(css).toContain("100% { opacity: 1; }");
  });
});

describe("a sheet on the Tide flavor", () => {
  const y = (text: string | null | undefined) => Number((text ?? "0px 0px").split(" ")[1].replace("px", ""));
  const translates = (envs: ReturnType<typeof setup>["envs"], target: object) =>
    envs.layout.writes.filter((write) => write.target === target && write.property === "translate").map((write) => write.value);

  it("opens: the page dims to 1 on the follower and never past it, and the rows rise one after another", () => {
    const { backdrop, rows, envs, ui } = setup();
    ui.open();
    expect(ui.getState().dimming).toBe(true);
    envs.page.settle();
    const dims = envs.page.writesTo("--tide-dim").map((write) => Number(write.value));
    expect(dims.length).toBeGreaterThan(2);
    expect(Math.max(...dims)).toBeLessThanOrEqual(1);
    expect(envs.page.read(backdrop, "--tide-dim")).toBe("1");
    envs.timeline.run(ROW_STAGGER);
    const opacity = (row: object) => Number(envs.timeline.valuesOf(row, "opacity").at(-1));
    expect(opacity(rows[0])).toBeGreaterThan(0);
    expect(opacity(rows[1])).toBe(0);
    envs.timeline.run(4000);
    for (const row of rows) {
      expect(envs.timeline.valuesOf(row, "opacity").at(-1)).toBe("1");
      expect(envs.timeline.valuesOf(row, "translate").at(-1)).toBe("0px 0px");
    }
    // The ripple spring carries each row past its place before it settles, as the figure of the guide shows.
    const offsets = envs.timeline.valuesOf(rows[0], "translate").map(y);
    expect(Math.min(...offsets)).toBeLessThan(0);
    expect(envs.timeline.pending).toBe(0);
    expect(ui.getState().playing).toBe(false);
  });

  it("lets a finger drag the sheet, and a slow release rests on the nearest of three heights and does not close", () => {
    const { sheet, envs, ui } = setup();
    envs.pointer.press(sheet, [0, 0], [0, 200], 400);
    envs.pointer.time += 300;
    envs.pointer.up(sheet, 0, 200);
    envs.pointer.settle();
    expect(envs.pointer.read(sheet)).toBe(`0px ${HEIGHT / 2}px`);
    expect(ui.getState().closed).toBe(false);
    expect(envs.pointer.removed).toBe(0);
  });

  it("does not close on a fast flick down that is shorter than the swipe distance", () => {
    const { sheet, envs, ui } = setup();
    const distance = tide.gesture.swipe.distance;
    envs.pointer.press(sheet, [0, 0], [0, distance - 18], 16);
    envs.pointer.up(sheet, 0, distance - 18);
    expect(ui.getState().closed).toBe(false);
    expect(envs.pointer.removed).toBe(0);
  });

  it("does not close on a flick up", () => {
    const { sheet, envs, ui } = setup();
    envs.pointer.press(sheet, [0, 0], [0, 200], 400);
    envs.pointer.time += 300;
    envs.pointer.up(sheet, 0, 200);
    envs.pointer.settle();
    envs.pointer.press(sheet, [0, 240], [0, 110], 80);
    envs.pointer.up(sheet, 0, 110);
    envs.pointer.settle();
    expect(ui.getState().closed).toBe(false);
    expect(envs.pointer.read(sheet)).toBe("0px 0px");
  });

  it("closes on a flick down: the dim clears, and the sheet slides out from where the finger left it, with no jump, and is removed at rest", () => {
    const { sheet, page, backdrop, envs, ui } = setup();
    ui.open();
    envs.page.settle();
    envs.pointer.press(sheet, [0, 0], [0, 130], 80);
    envs.pointer.up(sheet, 0, 130);
    expect(ui.getState().closed).toBe(true);
    expect(envs.pointer.removed).toBe(1);
    const left = envs.pointer.read(sheet);
    expect(y(left)).toBe(130);
    // A frame too short for a slice writes the pose the exit starts from: the place where the drag left the sheet.
    envs.layout.tick(1);
    expect(translates(envs, sheet)[0]).toBe(left);
    envs.page.settle();
    expect(envs.page.read(backdrop, "--tide-dim")).toBe("0");
    expect(envs.layout.unmounted).toEqual([]);
    envs.layout.run(5000);
    expect(y(translates(envs, sheet).at(-2))).toBeCloseTo(HEIGHT, 0);
    expect(envs.layout.unmounted.map((entry) => [entry.container, entry.target])).toEqual([[page, sheet]]);
  });

  it("closes when close is called, once, however many times it is called", () => {
    const { sheet, page, envs, ui } = setup();
    ui.close();
    ui.close();
    expect(ui.getState()).toMatchObject({ closed: true, exiting: 1 });
    // The sheet was never dragged, so the exit starts at 0. A frame too short for a slice leaves it showing at 0.
    envs.layout.tick(1);
    expect(envs.layout.style(sheet, "translate") ?? "0px 0px").toBe("0px 0px");
    envs.layout.run(5000);
    ui.close();
    expect(envs.layout.unmounted.map((entry) => [entry.container, entry.target])).toEqual([[page, sheet]]);
    expect(envs.pointer.removed).toBe(1);
  });

  it("glides each row from its old place to its new one when the order changes", () => {
    const { rows, envs, ui } = setup();
    const first = envs.layout.natural.get(rows[0])!;
    const second = envs.layout.natural.get(rows[1])!;
    ui.reorder(() => {
      envs.layout.place(rows[0], second);
      envs.layout.place(rows[1], first);
    });
    expect(ui.getState().gliding).toBe(2);
    expect(envs.layout.visual(rows[0]).y).toBeCloseTo(first.y, 3);
    expect(envs.layout.visual(rows[1]).y).toBeCloseTo(second.y, 3);
    envs.layout.run(5000);
    expect(ui.getState().gliding).toBe(0);
    expect(envs.layout.style(rows[0], "translate")).toBeUndefined();
    expect(envs.layout.visual(rows[0]).y).toBe(second.y);
  });

  it("opens a row into a card as one element", () => {
    const { rows, envs, ui } = setup();
    const card = { id: "card" };
    envs.layout.place(card, box(0, 0, 360, 600));
    const layout = ui.expand("row-0", rows[0], card);
    const start = envs.layout.visual(card);
    const from = envs.layout.natural.get(rows[0])!;
    expect([start.x, start.y, start.width, start.height].map((n) => Math.round(n))).toEqual([from.x, from.y, from.width, from.height]);
    envs.layout.run(5000);
    expect(layout.getState().moving).toBe(false);
    expect(envs.layout.visual(card)).toEqual(box(0, 0, 360, 600));
  });

  it("snaps under reduced motion: the dim, the rows, a release, a change of order, and a close land with no frame", () => {
    const { sheet, page, backdrop, rows, envs, ui } = setup();
    for (const env of Object.values(envs)) env.reduced = true;
    ui.open();
    expect(envs.page.read(backdrop, "--tide-dim")).toBe("1");
    for (const row of rows) expect(envs.timeline.valuesOf(row, "opacity").at(-1)).toBe("1");
    envs.pointer.press(sheet, [0, 0], [0, 200], 400);
    envs.pointer.time += 300;
    envs.pointer.up(sheet, 0, 200);
    expect(envs.pointer.read(sheet)).toBe(`0px ${HEIGHT / 2}px`);
    const first = envs.layout.natural.get(rows[0])!;
    ui.reorder(() => {
      envs.layout.place(rows[0], envs.layout.natural.get(rows[1])!);
      envs.layout.place(rows[1], first);
    });
    expect(envs.layout.style(rows[0], "translate")).toBeUndefined();
    ui.close();
    expect(envs.layout.unmounted.map((entry) => entry.target)).toEqual([sheet]);
    expect(envs.layout.unmounted[0].container).toBe(page);
    expect(envs.page.pending + envs.timeline.pending + envs.pointer.pending + envs.layout.pending).toBe(0);
  });

  it("stops every controller on destroy, in the middle of a move, and cancels the frame each one asked for", () => {
    const { sheet, rows, envs, ui } = setup();
    ui.open();
    ui.reorder(() => {
      envs.layout.place(rows[0], envs.layout.natural.get(rows[2])!);
      envs.layout.place(rows[2], box(0, 340, 360, 48));
    });
    // A slow release: the sheet travels to the nearest height, so the drag has a frame pending.
    envs.pointer.press(sheet, [0, 0], [0, 200], 400);
    envs.pointer.time += 300;
    envs.pointer.up(sheet, 0, 200);
    for (const [name, env] of Object.entries(envs)) expect(env.pending, name).toBeGreaterThan(0);
    expect(ui.getState()).toMatchObject({ dimming: true, dragging: true, playing: true, gliding: 2 });
    ui.destroy();
    expect(envs.pointer.removed).toBe(1);
    for (const [name, env] of Object.entries(envs)) expect(env.pending, name).toBe(0);
    expect(envs.pointer.cancelled).not.toEqual([]);
    expect(ui.getState()).toMatchObject({ dimming: false, dragging: false, playing: false, gliding: 0, exiting: 0 });
  });

  it("stops a drag that a finger still holds on destroy", () => {
    const { sheet, envs, ui } = setup();
    envs.pointer.down(sheet, 0, 0);
    envs.pointer.time += 16;
    envs.pointer.move(sheet, 0, 40);
    expect(ui.getState().dragging).toBe(true);
    ui.destroy();
    expect(envs.pointer.removed).toBe(1);
    expect(envs.pointer.pending).toBe(0);
    expect(ui.getState().dragging).toBe(false);
  });
});
