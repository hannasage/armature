/** A node with attributes, a rectangle, and a parent chain, enough for delegation. */
export class FakeNode {
  attrs: Record<string, string>;
  constructor(
    attrs: Record<string, string> = {},
    public rect = { left: 0, top: 0, width: 100, height: 50 },
    public parent: FakeNode | null = null,
  ) {
    this.attrs = attrs;
  }
  getAttribute(name: string) {
    return name in this.attrs ? this.attrs[name] : null;
  }
  closest(selector: string): FakeNode | null {
    if (selector === "[data-lqg]" && "data-lqg" in this.attrs) return this;
    return this.parent?.closest(selector) ?? null;
  }
  getBoundingClientRect() {
    return this.rect;
  }
}

type Listener = (event: never) => void;

/** A document stand-in: a listener table and a group query. */
export class FakeRoot {
  listeners = new Map<string, Array<{ listener: Listener; options: unknown }>>();
  removed: Array<{ type: string; options: unknown }> = [];
  members: FakeNode[] = [];
  queries: string[] = [];
  addEventListener(type: string, listener: Listener, options?: unknown) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), { listener, options }]);
  }
  removeEventListener(type: string, listener: Listener, options?: unknown) {
    this.removed.push({ type, options });
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry.listener !== listener));
  }
  querySelectorAll(selector: string) {
    this.queries.push(selector);
    const match = /data-lqg-group="([^"]+)"/.exec(selector);
    return this.members.filter((node) => node.attrs["data-lqg"] !== undefined && (!match || node.attrs["data-lqg-group"] === match[1]));
  }
  fire(type: string, target: unknown, event: Record<string, unknown> = {}) {
    for (const { listener } of this.listeners.get(type) ?? []) (listener as (event: unknown) => void)({ pointerType: "mouse", isPrimary: true, button: 0, clientX: 0, clientY: 0, ...event, target });
  }
  get listenerCount() {
    return [...this.listeners.values()].reduce((sum, entries) => sum + entries.length, 0);
  }
}
