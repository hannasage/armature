import { describe, expect, it, vi } from "vitest";
import type { Flavor } from "../../src/engine/flavor";
import { FakeEnv } from "../helpers/fake-env";
import { FakeLayoutEnv } from "../helpers/fake-layout-env";
import { FakePointerEnv } from "../helpers/fake-pointer-env";
import { lofty } from "../helpers/layout-flavor";
import { swipey } from "../helpers/gesture-flavor";
import { acme } from "../helpers/other-flavor";
import { clientCodeOf, renderOnServer } from "../helpers/svelte-ssr";

// A server render has no DOM, and Svelte never runs a `use:` action on the server. The component below uses every action of the adapter.
// The test compiles it the way Svelte does for a server (`compile` with `generate: "server"`) and renders it with `render` from `svelte/server`.

const follows: Flavor = { ...acme, followers: { thumb: { var: "thumb", springKey: "tap", rest: { restDelta: 0.001, restSpeed: 0.01 } } } };

const source = `<script>
  import { surface, follow, drag, layout } from "@hannasage/armature/svelte";
  let { flavors, envs, ready } = $props();
</script>
<section>
  <button use:surface={{ flavor: flavors.glass, env: envs.surface, onReady: ready }}>press</button>
  <i use:follow={{ flavor: flavors.follow, name: "thumb", initial: 0.5, env: envs.follow, onReady: ready }}>thumb</i>
  <b use:drag={{ flavor: flavors.drag, env: envs.drag, onReady: ready }}>drag</b>
  <u use:layout={{ flavor: flavors.layout, env: envs.layout, onReady: ready }}>layout</u>
</section>`;

describe("the Svelte actions on the server", () => {
  it("renders a component that uses every action to a string, and runs none of them", async () => {
    const envs = { surface: new FakeEnv(), follow: new FakeEnv(), drag: new FakePointerEnv(), layout: new FakeLayoutEnv() };
    const ready = vi.fn();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const html = await renderOnServer(source, { flavors: { glass: acme, follow: follows, drag: swipey, layout: lofty }, envs, ready });
    expect(html).toContain("<button>press</button>");
    expect(html).toContain("<i>thumb</i>");
    expect(html).toContain("<b>drag</b>");
    expect(html).toContain("<u>layout</u>");
    expect(ready).not.toHaveBeenCalled();
    expect(envs.surface.requested + envs.follow.requested + envs.layout.requested).toBe(0);
    expect(envs.follow.writes).toHaveLength(0);
    expect(envs.drag.added).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("has no window and no document in this run", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });

  it("compiles each `use:` directive on the client to a call of the action", () => {
    const code = clientCodeOf(source);
    for (const name of ["surface", "follow", "drag", "layout"]) expect(code, name).toMatch(new RegExp(`\\$\\.action\\([^\\n]*=> ${name}\\??\\.?\\(`));
  });
});
