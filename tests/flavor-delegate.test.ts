import { describe, expect, it } from "vitest";
import * as delegate from "../src/dom/delegate";
import { installDelegation, type DelegateOptions } from "../src/dom/delegate";
import type { LqgProviderProps } from "../src/react";
import type { Flavor } from "../src/engine/flavor";
import * as legacy from "./golden/legacy/delegate";
import { FakeEnv } from "./helpers/fake-env";
import { acme } from "./helpers/other-flavor";

/** A node that knows the acme attributes. The shared fake knows only `data-lqg`. */
class AcmeNode {
  constructor(public attrs: Record<string, string> = {}, public rect = { left: 0, top: 0, width: 100, height: 50 }, public parent: AcmeNode | null = null) {}
  getAttribute(name: string) { return name in this.attrs ? this.attrs[name] : null; }
  closest(selector: string): AcmeNode | null {
    const name = /^\[([\w-]+)\]$/.exec(selector)?.[1];
    if (name && name in this.attrs) return this;
    return this.parent?.closest(selector) ?? null;
  }
  getBoundingClientRect() { return this.rect; }
}

class AcmeRoot {
  listeners = new Map<string, Array<(event: unknown) => void>>();
  members: AcmeNode[] = [];
  queries: string[] = [];
  addEventListener(type: string, listener: (event: never) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener as (event: unknown) => void]); }
  removeEventListener() { /* not needed */ }
  querySelectorAll(selector: string) {
    this.queries.push(selector);
    const group = /data-acme-set="([^"]+)"/.exec(selector)?.[1];
    return this.members.filter((node) => "data-acme" in node.attrs && (!group || node.attrs["data-acme-set"] === group));
  }
  fire(type: string, target: unknown, event: Record<string, unknown> = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener({ pointerType: "mouse", isPrimary: true, button: 0, clientX: 50, clientY: 20, ...event, target });
  }
}

describe("delegate keeps its old exports", () => {
  it("has every legacy export, with the same value for each constant", () => {
    for (const [name, value] of Object.entries(legacy)) {
      expect(name in delegate, name).toBe(true);
      const now = (delegate as Record<string, unknown>)[name];
      if (typeof value === "function") expect(typeof now, name).toBe("function");
      else expect(now, name).toStrictEqual(value);
    }
    expect(Object.isFrozen(delegate.FEELS)).toBe(true);
  });
});

describe("a delegate with another flavor", () => {
  it("makes surfaces for the flavor's attribute and ignores the glass attribute", () => {
    const env = new FakeEnv();
    const root = new AcmeRoot();
    const mine = new AcmeNode({ "data-acme": "" });
    const glassOnly = new AcmeNode({ "data-lqg": "" });
    const handle = installDelegation(root, { env, flavor: acme });
    root.fire("pointerdown", mine);
    root.fire("pointerdown", glassOnly);
    env.settle();
    expect(handle.surfaceCount).toBe(1);
    expect(env.read(mine, "--acme-squeeze")).toBe("0.9");
    expect(env.vars.get(glassOnly)).toBeUndefined();
    expect(env.writes.some((write) => write.name.includes("lqg"))).toBe(false);
  });

  it("finds a group by the flavor's group attribute and lights its members", () => {
    const env = new FakeEnv();
    const root = new AcmeRoot();
    const a = new AcmeNode({ "data-acme": "", "data-acme-set": "row" });
    const b = new AcmeNode({ "data-acme": "", "data-acme-set": "row" }, { left: 120, top: 0, width: 100, height: 50 });
    const other = new AcmeNode({ "data-acme": "", "data-acme-set": "col" }, { left: 120, top: 0, width: 100, height: 50 });
    root.members = [a, b, other];
    installDelegation(root, { env, flavor: acme });
    root.fire("pointerdown", a);
    env.settle();
    expect(root.queries).toContain('[data-acme][data-acme-set="row"]');
    expect(env.read(b, "--acme-halo")).toBeDefined();
    expect(env.vars.get(other)).toBeUndefined();
  });

  it("reads feels from the flavor and ignores a name only the glass flavor has", () => {
    const run = (feel: string | undefined) => {
      const env = new FakeEnv();
      const root = new AcmeRoot();
      const node = new AcmeNode({ "data-acme": "", ...(feel ? { "data-acme-mood": feel } : {}) });
      installDelegation(root, { env, flavor: acme });
      root.fire("pointerdown", node);
      env.settle();
      return env.read(node, "--acme-squeeze");
    };
    expect(run("soft")).toBe("0.95");
    expect(run(undefined)).toBe("0.9");
    expect(run("calm")).toBe("0.9");
    expect(run("constructor")).toBe("0.9");
  });

  it("walks up to the closest surface from a child", () => {
    const env = new FakeEnv();
    const root = new AcmeRoot();
    const host = new AcmeNode({ "data-acme": "" });
    const child = new AcmeNode({}, undefined, host);
    const handle = installDelegation(root, { env, flavor: acme });
    root.fire("pointerdown", child);
    expect(handle.surfaceCount).toBe(1);
  });

  it("fails with a clear error when the flavor has no surface part", () => {
    const bare: Flavor = { name: "bare", prefix: "zz", logLabel: "bare", springs: {} };
    expect(() => installDelegation(new AcmeRoot(), { env: new FakeEnv(), flavor: bare })).toThrow('The flavor "bare" has no surface part.');
  });
});

describe("the surface option cannot carry a flavor", () => {
  it("is a type error on DelegateOptions.surface and on the LqgProvider surface prop", () => {
    // @ts-expect-error A flavor in the surface options would be silently overwritten by the delegate flavor.
    const viaDelegate: DelegateOptions = { surface: { flavor: acme } };
    // @ts-expect-error The same rule holds for the provider prop.
    const viaProvider: LqgProviderProps = { surface: { flavor: acme } };
    expect([viaDelegate, viaProvider]).toHaveLength(2);
  });
  it("at run time the delegate flavor wins over a flavor smuggled into the surface options", () => {
    const env = new FakeEnv();
    const root = new AcmeRoot();
    const node = new AcmeNode({ "data-acme": "" });
    const smuggled = { flavor: { ...acme, prefix: "other" } } as unknown as DelegateOptions["surface"];
    installDelegation(root, { env, flavor: acme, surface: smuggled });
    root.fire("pointerdown", node);
    env.settle();
    expect(env.read(node, "--acme-squeeze")).toBe("0.9");
    expect(env.writes.some((write) => write.name.includes("other"))).toBe(false);
  });
});
