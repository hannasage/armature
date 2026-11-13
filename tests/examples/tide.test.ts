import { describe, expect, it } from "vitest";
import { requireFollower, validateFlavor, type Flavor } from "@hannasage/armature";
import { cssFlavor, cssKeyframes } from "@hannasage/armature/css";
import { requireGesture } from "@hannasage/armature/gesture";
import { glassFlavor } from "@hannasage/armature/glass";
import { requireLayout } from "@hannasage/armature/layout";
import { requireTimeline } from "@hannasage/armature/timeline";
import { projection } from "../../examples/projection/flavor";
import { tide } from "../../examples/tide/flavor";
import { createSheet, ROW_STAGGER } from "../../examples/tide/sheet";
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

const springs = (flavor: Flavor) => Object.values(flavor.springs).map((spring) => JSON.stringify({ mass: 1, ...spring }));

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
      for (const spring of springs(tide)) expect(springs(other), `${other.name} ${spring}`).not.toContain(spring);
    }
  });

  it("uses none of the parts that glass and Projection carry, and copies no part of the test flavors", () => {
    expect(tide).not.toHaveProperty("surface");
    expect(tide).not.toHaveProperty("lens");
    expect(tide).not.toHaveProperty("reveal");
    expect(tide.gesture).not.toEqual(swipey.gesture);
    expect(tide.timeline).not.toEqual(tempo.timeline);
    expect(tide.layout).not.toEqual(lofty.layout);
    expect(tide.followers.dim).not.toEqual(projection.followers.thumb);
  });

  it("writes a stylesheet and keyframes through the CSS output", () => {
    expect(cssFlavor(tide)).toContain("@property --tide-dim { syntax: \"<number>\"; inherits: true; initial-value: 0; }");
    const css = cssKeyframes("tide-rise", { flavor: tide, tracks: [{ property: "opacity", sequence: "rise" }] });
    expect(css.startsWith("@keyframes tide-rise {")).toBe(true);
    expect(css).toContain("100% { opacity: 1; }");
  });
});

describe("a sheet on the Tide flavor", () => {
  it("opens: the page dims to 1 on the follower, and the rows rise one after another", () => {
    const { backdrop, rows, envs, ui } = setup();
    ui.open();
    envs.page.settle();
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
    expect(envs.timeline.pending).toBe(0);
  });

  it("lets a finger drag the sheet, and a slow release rests on the nearest of three heights", () => {
    const { sheet, envs } = setup();
    envs.pointer.press(sheet, [0, 0], [0, 200], 400);
    envs.pointer.time += 300;
    envs.pointer.up(sheet, 0, 200);
    envs.pointer.settle();
    expect(envs.pointer.read(sheet)).toBe(`0px ${HEIGHT / 2}px`);
  });

  it("closes on a flick down: the dim clears, and the sheet slides out and is removed when it rests", () => {
    const { sheet, page, backdrop, envs, ui } = setup();
    ui.open();
    envs.page.settle();
    envs.pointer.press(sheet, [0, 0], [0, 130], 80);
    envs.pointer.up(sheet, 0, 130);
    expect(envs.pointer.removed).toBe(1);
    envs.page.settle();
    expect(envs.page.read(backdrop, "--tide-dim")).toBe("0");
    expect(envs.layout.unmounted).toEqual([]);
    envs.layout.run(5000);
    expect(envs.layout.unmounted.map((entry) => [entry.container, entry.target])).toEqual([[page, sheet]]);
  });

  it("glides each row from its old place to its new one when the order changes", () => {
    const { rows, envs, ui } = setup();
    const first = envs.layout.natural.get(rows[0])!;
    const second = envs.layout.natural.get(rows[1])!;
    ui.reorder(() => {
      envs.layout.place(rows[0], second);
      envs.layout.place(rows[1], first);
    });
    expect(envs.layout.visual(rows[0]).y).toBeCloseTo(first.y, 3);
    expect(envs.layout.visual(rows[1]).y).toBeCloseTo(second.y, 3);
    envs.layout.run(5000);
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

  it("snaps under reduced motion: the dim and the rows land with no frame", () => {
    const { backdrop, rows, envs, ui } = setup();
    envs.page.reduced = true;
    envs.timeline.reduced = true;
    ui.open();
    expect(envs.page.read(backdrop, "--tide-dim")).toBe("1");
    for (const row of rows) expect(envs.timeline.valuesOf(row, "opacity").at(-1)).toBe("1");
    expect(envs.page.pending + envs.timeline.pending).toBe(0);
  });

  it("stops every controller on destroy", () => {
    const { envs, ui } = setup();
    ui.open();
    ui.destroy();
    expect(envs.pointer.removed).toBe(1);
    expect(envs.page.pending + envs.timeline.pending + envs.pointer.pending + envs.layout.pending).toBe(0);
  });
});
