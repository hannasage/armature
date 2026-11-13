import { createSSRApp, defineComponent, h, ref } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it, vi } from "vitest";
import { useArmatureDrag, useArmatureFollower, useArmatureLayout, useArmatureSurface } from "../../src/vue";
import type { Flavor } from "../../src/engine/flavor";
import { FakeEnv } from "../helpers/fake-env";
import { FakeLayoutEnv } from "../helpers/fake-layout-env";
import { FakePointerEnv } from "../helpers/fake-pointer-env";
import { lofty } from "../helpers/layout-flavor";
import { swipey } from "../helpers/gesture-flavor";
import { acme } from "../helpers/other-flavor";

// A server render has no DOM and runs no mount hook. Every composable must still give a handle, and must touch no browser global and no environment.

const follows: Flavor = { ...acme, followers: { thumb: { var: "thumb", springKey: "tap", rest: { restDelta: 0.001, restSpeed: 0.01 } } } };

const render = (setup: () => { controller: { value: unknown }; failed: { value: unknown } }) =>
  renderToString(
    createSSRApp(
      defineComponent({
        setup() {
          const handle = setup();
          return () => h("p", { "data-ready": String(handle.controller.value !== null), "data-failed": String(handle.failed.value !== undefined) });
        },
      }),
    ),
  );

describe("the Vue composables on the server", () => {
  it("has no window and no document in this run", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });

  it("renders useArmatureFollower to a string, with no controller and no write", async () => {
    const env = new FakeEnv();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const html = await render(() => useArmatureFollower(ref(null), { flavor: follows, name: "thumb", initial: 0.5, env }));
    expect(html).toBe('<p data-ready="false" data-failed="false"></p>');
    expect(env.writes).toHaveLength(0);
    expect(env.requested).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("renders useArmatureSurface to a string, and adds no listener", async () => {
    const env = new FakeEnv();
    const html = await render(() => useArmatureSurface(ref(null), { flavor: acme, env }));
    expect(html).toBe('<p data-ready="false" data-failed="false"></p>');
    expect(env.requested).toBe(0);
  });

  it("renders useArmatureDrag to a string, and adds no pointer handler", async () => {
    const env = new FakePointerEnv();
    const html = await render(() => useArmatureDrag(ref(null), { flavor: swipey, env }));
    expect(html).toBe('<p data-ready="false" data-failed="false"></p>');
    expect(env.added).toBe(0);
  });

  it("renders useArmatureLayout to a string, and measures nothing", async () => {
    const env = new FakeLayoutEnv();
    const html = await render(() => useArmatureLayout(ref(null), { flavor: lofty, env }));
    expect(html).toBe('<p data-ready="false" data-failed="false"></p>');
    expect(env.measured).toHaveLength(0);
    expect(env.requested).toBe(0);
  });

  it("does not fail on the server when the flavor is wrong, because the flavor is read at mount", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const html = await render(() => useArmatureFollower(ref(null), { flavor: acme, name: "none" }));
    expect(html).toBe('<p data-ready="false" data-failed="false"></p>');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
