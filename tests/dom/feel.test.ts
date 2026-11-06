import { describe, expect, it } from "vitest";
import { FEELS, installDelegation } from "../../src/dom/delegate";
import { FakeNode, FakeRoot } from "../helpers/fake-dom";
import { FakeEnv } from "../helpers/fake-env";

// A named feel on an element (data-lqg-feel="calm") quiets its motion: a lighter press, a gentler release, and a glow that
// spreads to its neighbours at half strength. Without it, or with a name nobody knows, a surface moves as it always did.
function setup(feel?: string) {
  const env = new FakeEnv();
  const root = new FakeRoot();
  installDelegation(root, { env });
  const attrs = (extra: Record<string, string> = {}) => ({ "data-lqg": "", "data-lqg-group": "g", ...(feel ? { "data-lqg-feel": feel } : {}), ...extra });
  const button = new FakeNode(attrs(), { left: 0, top: 0, width: 200, height: 48 });
  const next = new FakeNode(attrs(), { left: 260, top: 0, width: 200, height: 48 });
  root.members = [button, next];
  return { env, root, button, next, v: (name: string, target: object) => Number(env.read(target, name)) };
}

function overshootOf(feel?: string) {
  const t = setup(feel);
  t.root.fire("pointerdown", t.button);
  t.env.settle();
  const pressed = t.v("--lqg-press", t.button);
  t.root.fire("pointerup", t.button);
  let peak = 0;
  while (t.env.pending > 0) { t.env.tick(); peak = Math.max(peak, t.v("--lqg-press", t.button)); }
  return { pressed, peak, travel: 1 - pressed };
}

describe("the calm feel", () => {
  it("presses to 0.985 and still springs back past 1", () => {
    const calm = overshootOf("calm");
    expect(calm.pressed).toBeCloseTo(0.985, 3);
    expect(calm.peak).toBeGreaterThan(1.0005);
  });

  it("overshoots less than the default does, as a share of the press travel", () => {
    const calm = overshootOf("calm");
    const normal = overshootOf();
    expect((calm.peak - 1) / calm.travel).toBeLessThan((normal.peak - 1) / normal.travel);
  });

  it("spreads about half the glow to a neighbour", () => {
    const calm = setup("calm");
    calm.root.fire("pointermove", calm.button, { clientX: 100, clientY: 24 });
    calm.env.settle();
    const normal = setup();
    normal.root.fire("pointermove", normal.button, { clientX: 100, clientY: 24 });
    normal.env.settle();
    const ratio = calm.v("--lqg-glow", calm.next) / normal.v("--lqg-glow", normal.next);
    expect(ratio).toBeGreaterThan(0.45);
    expect(ratio).toBeLessThan(0.55);
    expect(calm.v("--lqg-glow", calm.button)).toBeCloseTo(normal.v("--lqg-glow", normal.button), 3);
  });
});

describe("a feel nobody knows", () => {
  it("is ignored: the surface moves as it does with no feel", () => {
    expect(overshootOf("loud").pressed).toBeCloseTo(0.97, 3);
  });
});

describe("the calm feel is a named preset", () => {
  it("names calm, with a 0.985 press and half a neighbour share, and nothing else", () => {
    expect(Object.keys(FEELS)).toEqual(["calm"]);
    expect(FEELS.calm).toMatchObject({ pressScale: 0.985, neighborShare: 0.5 });
  });
});
