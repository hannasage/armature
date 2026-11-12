import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { useArmatureFollower } from "../../src/react";
import type { Flavor } from "../../src/engine/flavor";
import { acme } from "../helpers/other-flavor";

// A server render has no DOM and runs no effect. The hook must still give a handle with the initial state.
const flavor: Flavor = {
  ...acme,
  followers: { thumb: { var: "thumb", springKey: "tap", rest: { restDelta: 0.001, restSpeed: 0.01 } } },
};

function Thumb({ initial }: { initial?: number }) {
  const handle = useArmatureFollower({ current: null }, { flavor, name: "thumb", initial });
  const state = handle.getState();
  return <p data-value={state.value} data-moving={String(state.moving)} />;
}

describe("useArmatureFollower on the server", () => {
  it("renders to a string with no DOM and finds the initial state", () => {
    expect(renderToStaticMarkup(<Thumb initial={0.75} />)).toBe('<p data-value="0.75" data-moving="false"></p>');
  });

  it("starts at 0 when no initial value is given, and touches no browser global", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(renderToStaticMarkup(<Thumb />)).toBe('<p data-value="0" data-moving="false"></p>');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
