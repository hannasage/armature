import type { LqgScrollEnvironment, ScrollElement, ScrollEntry, ScrollObserver, ScrollRoot } from "../../src/engine/scroll-env";

/** A page stand-in for the scroll controllers: a manual clock and frame queue, a scroll position, and a record of every write. */
export class FakeScrollEnv implements LqgScrollEnvironment {
  time = 0;
  y = 0;
  height = 900;
  reduced = false;
  hidden = false;
  nextId = 1;
  frames = new Map<number, (time: number) => void>();
  requested = 0;
  cancelled: number[] = [];
  scrollListeners = new Set<() => void>();
  addedScroll = 0;
  removedScroll = 0;
  visibilityListeners = new Set<(hidden: boolean) => void>();
  reducedListeners = new Set<(reduced: boolean) => void>();
  focusListeners = new Set<(target: ScrollElement | null) => void>();
  changeListeners = new Set<() => void>();
  watchers = 0;
  timers = new Map<number, { run: () => void; at: number }>();
  nextTimer = 1;
  observerCreated = 0;
  observerDisconnected = 0;
  observed = new Set<ScrollElement>();
  deliver: ((entries: ScrollEntry[]) => void) | undefined;
  rootMargin = "";
  hasObserver = true;
  styleWrites: Array<{ target: ScrollElement; property: string; value: string | null }> = [];
  styles = new Map<ScrollElement, Record<string, string>>();
  attrs = new Map<ScrollElement, Record<string, string>>();

  requestFrame = (callback: (time: number) => void) => {
    const id = this.nextId++;
    this.requested += 1;
    this.frames.set(id, callback);
    return id;
  };
  cancelFrame = (id: number) => {
    this.cancelled.push(id);
    this.frames.delete(id);
  };
  /** How far `now()` runs ahead of the frame time a callback receives, as in a browser where a frame callback starts late in the frame. */
  lag = 0;
  now = () => this.time + this.lag;
  matchMedia = (query: string) => ({ matches: query.includes("prefers-reduced-motion") && this.reduced });
  /** The height of the whole page. Undefined means the environment cannot say. */
  docHeight: number | undefined = undefined;
  scrollHeight = () => this.docHeight as number;
  resizeListeners = new Set<() => void>();
  onResize = (listener: () => void) => {
    this.resizeListeners.add(listener);
    return () => { this.resizeListeners.delete(listener); };
  };
  /** The window was resized or zoomed. */
  resize() {
    for (const listener of [...this.resizeListeners]) listener();
  }
  scrollY = () => this.y;
  viewportHeight = () => this.height;
  onScroll = (listener: () => void) => {
    this.scrollListeners.add(listener);
    this.addedScroll += 1;
    return () => {
      this.scrollListeners.delete(listener);
      this.removedScroll += 1;
    };
  };
  tabHidden = () => this.hidden;
  onVisibilityChange = (listener: (hidden: boolean) => void) => {
    this.visibilityListeners.add(listener);
    return () => { this.visibilityListeners.delete(listener); };
  };
  onReducedMotionChange = (listener: (reduced: boolean) => void) => {
    this.reducedListeners.add(listener);
    return () => { this.reducedListeners.delete(listener); };
  };
  setStyle = (target: ScrollElement, property: string, value: string | null) => {
    this.styleWrites.push({ target, property, value });
    const next = { ...(this.styles.get(target) ?? {}) };
    if (value === null) delete next[property];
    else next[property] = value;
    this.styles.set(target, next);
  };
  setAttribute = (target: ScrollElement, name: string, value: string | null) => {
    const next = { ...(this.attrs.get(target) ?? {}) };
    if (value === null) delete next[name];
    else next[name] = value;
    this.attrs.set(target, next);
  };
  createIntersectionObserver = this.makeObserverFactory();
  watch = (_root: ScrollRoot, onChange: () => void) => {
    this.watchers += 1;
    this.changeListeners.add(onChange);
    return { disconnect: () => { this.changeListeners.delete(onChange); } };
  };
  onFocusIn = (_root: ScrollRoot, listener: (target: ScrollElement | null) => void) => {
    this.focusListeners.add(listener);
    return () => { this.focusListeners.delete(listener); };
  };
  setTimeout = (run: () => void, ms: number) => {
    const id = this.nextTimer++;
    this.timers.set(id, { run, at: this.time + ms });
    return id;
  };
  clearTimeout = (id: number) => { this.timers.delete(id); };

  private makeObserverFactory(): LqgScrollEnvironment["createIntersectionObserver"] {
    return (deliver, rootMargin) => {
      this.observerCreated += 1;
      this.deliver = deliver;
      this.rootMargin = rootMargin;
      const observer: ScrollObserver = {
        observe: target => { this.observed.add(target); },
        unobserve: target => { this.observed.delete(target); },
        disconnect: () => { this.observerDisconnected += 1; this.observed.clear(); },
      };
      return observer;
    };
  }

  /** Turns the observer off, as a browser with no IntersectionObserver. */
  withoutObserver() {
    this.createIntersectionObserver = undefined;
    return this;
  }

  /** Moves the page and fires the scroll listeners. */
  scrollTo(y: number) {
    this.y = y;
    for (const listener of [...this.scrollListeners]) listener();
  }
  get pending() {
    return this.frames.size;
  }
  /** One frame: advances the clock, then runs the callbacks that were queued before it. */
  tick(ms = 1000 / 60) {
    this.time += ms;
    const callbacks = [...this.frames.values()];
    this.frames.clear();
    for (const callback of callbacks) callback(this.time);
    for (const [id, timer] of [...this.timers]) if (timer.at <= this.time) { this.timers.delete(id); timer.run(); }
  }
  /** Frames until none is pending or `limit` pass. Returns how many ran. */
  settle(ms = 1000 / 60, limit = 2000) {
    let ran = 0;
    while (this.pending > 0 && ran < limit) { this.tick(ms); ran += 1; }
    return ran;
  }
  /** Advances the clock without frames, running due timers. */
  advance(ms: number) {
    this.time += ms;
    for (const [id, timer] of [...this.timers]) if (timer.at <= this.time) { this.timers.delete(id); timer.run(); }
  }
  /** What the controller wrote last for one property, or undefined when it is not set. */
  style(target: ScrollElement, property: string) {
    return this.styles.get(target)?.[property];
  }
  attr(target: ScrollElement, name: string) {
    return this.attrs.get(target)?.[name];
  }
  /** Delivers one intersection batch. */
  enter(...entries: Array<{ target: ScrollElement; isIntersecting?: boolean }>) {
    this.deliver?.(entries.map(entry => ({ target: entry.target, isIntersecting: entry.isIntersecting ?? true, boundingClientRect: entry.target.getBoundingClientRect() })));
  }
  /** Nodes were added under the root. */
  mutate() {
    for (const listener of [...this.changeListeners]) listener();
  }
  setReduced(value: boolean) {
    this.reduced = value;
    for (const listener of [...this.reducedListeners]) listener(value);
  }
  setHidden(value: boolean) {
    this.hidden = value;
    for (const listener of [...this.visibilityListeners]) listener(value);
  }
  focus(target: ScrollElement | null) {
    for (const listener of [...this.focusListeners]) listener(target);
  }
}

/** An element stand-in: attributes, a rectangle, a parent chain, and children. */
export class FakeElement implements ScrollElement {
  isConnected = true;
  children: FakeElement[] = [];
  constructor(
    public attrs: Record<string, string> = {},
    public rect: { top: number; left: number; width: number; height: number } = { top: 0, left: 0, width: 300, height: 200 },
    public parent: FakeElement | null = null,
  ) {
    parent?.children.push(this);
  }
  getAttribute(name: string) { return name in this.attrs ? this.attrs[name] : null; }
  hasAttribute(name: string) { return name in this.attrs; }
  getBoundingClientRect() { return this.rect; }
  closest(selector: string): FakeElement | null {
    const attribute = /^\[([\w-]+)\]$/.exec(selector)?.[1];
    if (attribute && attribute in this.attrs) return this;
    const list = selector.split(",").map(part => part.trim());
    if (list.length > 1) for (const part of list) { const found = this.closest(part); if (found) return found; }
    return this.parent?.closest(selector) ?? null;
  }
  querySelectorAll(selector: string): FakeElement[] {
    const attribute = /^\[([\w-]+)\]$/.exec(selector)?.[1];
    const out: FakeElement[] = [];
    const walk = (node: FakeElement) => {
      for (const child of node.children) {
        if (attribute && attribute in child.attrs) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
}

/** A root that lists its targets for any selector the test names. */
export class FakeRoot implements ScrollRoot {
  members: FakeElement[] = [];
  queries: string[] = [];
  querySelectorAll(selector: string) {
    this.queries.push(selector);
    const names = selector.split(",").map(part => /^\[([\w-]+)\]$/.exec(part.trim())?.[1]).filter((name): name is string => Boolean(name));
    return this.members.filter(member => member.isConnected && names.some(name => name in member.attrs));
  }
}
