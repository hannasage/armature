import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LqgRevealProvider, useLqgReveal } from "../../src/react";
import { FakeElement, FakeRoot, FakeScrollEnv } from "../helpers/fake-scroll-env";

// Vitest here is Node only, so React's hook runtime cannot run effects. These stand-ins keep each hook's state and collect its
// effects, and the tests run them by hand, as React would after a commit. They exercise the real hook bodies.
const harness = vi.hoisted(() => ({ cells: [] as unknown[], cursor: 0, effects: [] as Array<() => unknown> }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useRef: (initial: unknown) => {
      const index = harness.cursor++;
      return (harness.cells[index] ??= { current: initial });
    },
    useEffect: (effect: () => unknown) => { harness.effects.push(effect); },
  };
});

beforeEach(() => { harness.cells = []; harness.cursor = 0; harness.effects = []; });
const commit = () => harness.effects.map(effect => effect()).filter((cleanup): cleanup is () => void => typeof cleanup === "function");

class Host extends FakeRoot {
  classes = new Set<string>();
  classList = { add: (...tokens: string[]) => tokens.forEach(token => this.classes.add(token)), remove: (...tokens: string[]) => tokens.forEach(token => this.classes.delete(token)) };
}

function Probe({ host, env }: { host: Host | null; env: FakeScrollEnv }) {
  const ref = { current: host as unknown as HTMLElement | null };
  useLqgReveal(ref, { env, armedClass: "js-reveal" });
  return null;
}

describe("LqgRevealProvider", () => {
  it("renders one div with its class and children, and nothing hidden, so server markup shows everything", () => {
    const html = renderToStaticMarkup(<LqgRevealProvider className="home-page"><p data-lqg-reveal="fade">Hello</p></LqgRevealProvider>);
    expect(html).toBe('<div class="home-page"><p data-lqg-reveal="fade">Hello</p></div>');
    expect(html).not.toContain("opacity");
    expect(html).not.toContain("style");
  });
});

describe("useLqgReveal", () => {
  it("arms when the host mounts, and its cleanup stops the reveal and shows everything", () => {
    const env = new FakeScrollEnv();
    const host = new Host();
    const card = new FakeElement({ "data-lqg-reveal": "drop" }, { top: 1600, left: 0, width: 10, height: 10 });
    host.members.push(card);
    renderToStaticMarkup(<Probe host={host} env={env} />);
    const cleanups = commit();
    expect(host.classes.has("js-reveal")).toBe(true);
    expect(env.style(card, "opacity")).toBe("0");
    expect(cleanups).toHaveLength(1);
    cleanups[0]();
    expect(host.classes.size).toBe(0);
    expect(env.style(card, "opacity")).toBeUndefined();
    expect(env.scrollListeners.size).toBe(0);
  });

  it("runs twice without harm, as React strict mode does", () => {
    const env = new FakeScrollEnv();
    const host = new Host();
    host.members.push(new FakeElement({ "data-lqg-reveal": "drop" }, { top: 1600, left: 0, width: 10, height: 10 }));
    renderToStaticMarkup(<Probe host={host} env={env} />);
    commit()[0]();
    commit()[0]();
    expect(env.scrollListeners.size).toBe(0);
    expect(host.classes.size).toBe(0);
  });

  it("does nothing when there is no host element yet", () => {
    const env = new FakeScrollEnv();
    renderToStaticMarkup(<Probe host={null} env={env} />);
    expect(commit()).toEqual([]);
    expect(env.styleWrites).toEqual([]);
  });
});
