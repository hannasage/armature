/**
 * Everything the scroll controllers take from the browser (GI-70). The velocity tracker and the reveal controller never touch
 * `window` or `document`, so a test passes a fake and forces every path in Node.
 */
import { REDUCED_MOTION_QUERY } from "./env";

/** What the controller reads from an element. An `HTMLElement` fits. */
export interface ScrollElement {
  readonly isConnected?: boolean;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  getBoundingClientRect(): { readonly top: number; readonly left: number; readonly width?: number; readonly height?: number };
  closest(selector: string): ScrollElement | null;
  querySelectorAll?(selector: string): Iterable<ScrollElement>;
}

/** What the controller reads from the root it watches. An `HTMLElement` fits. */
export interface ScrollRoot {
  querySelectorAll(selector: string): Iterable<ScrollElement>;
}

export interface ScrollEntry {
  readonly target: ScrollElement;
  readonly isIntersecting: boolean;
  readonly boundingClientRect: { readonly top: number; readonly left: number };
}

export interface ScrollObserver {
  observe(target: ScrollElement): void;
  unobserve(target: ScrollElement): void;
  disconnect(): void;
}

export interface ArmatureScrollEnvironment {
  requestFrame(callback: (time: number) => void): number;
  cancelFrame(id: number): void;
  /** Milliseconds, on the same clock as the time `requestFrame` passes to its callback. */
  now(): number;
  matchMedia?(query: string): { matches: boolean };
  /** The page scroll position, in pixels from the top. */
  scrollY(): number;
  viewportHeight(): number;
  /** The height of the whole page, in pixels. Optional. Without it a target in the last 8 percent of the page cannot be told from one that is still waiting. */
  scrollHeight?(): number;
  /** Calls back when the window is resized or zoomed. Optional. */
  onResize?(listener: () => void): () => void;
  /** A passive listener on window scroll. Returns the function that removes it. */
  onScroll(listener: () => void): () => void;
  tabHidden(): boolean;
  onVisibilityChange(listener: (hidden: boolean) => void): () => void;
  /** Calls back when the reduced motion setting changes. Optional. */
  onReducedMotionChange?(listener: (reduced: boolean) => void): () => void;
  /** Writes one inline style property, or removes it when `value` is null. */
  setStyle(target: ScrollElement, property: string, value: string | null): void;
  /** Sets an attribute, or removes it when `value` is null. */
  setAttribute(target: ScrollElement, name: string, value: string | null): void;
  /** Absent when the browser has no IntersectionObserver. Then the controller arms nothing. */
  createIntersectionObserver?(deliver: (entries: ScrollEntry[]) => void, rootMargin: string): ScrollObserver;
  /** Calls `onChange` when nodes are added under the root. Optional. */
  watch?(root: ScrollRoot, onChange: () => void): { disconnect(): void };
  /** Calls `listener` with the element that gains visible focus under the root, and with null for any other focus. Optional. */
  onFocusIn?(root: ScrollRoot, listener: (target: ScrollElement | null) => void): () => void;
  setTimeout(run: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

/** The real browser. Safe to import on the server: nothing runs until a method is called. It throws if `window` lacks matchMedia. */
export function createBrowserScrollEnvironment(win: Window & typeof globalThis = window): ArmatureScrollEnvironment {
  const reduced = win.matchMedia(REDUCED_MOTION_QUERY);
  const hasObserver = typeof win.IntersectionObserver === "function";
  const visibleFocus = (element: Element) => {
    try { return element.matches(":focus-visible"); } catch { return false; }
  };
  return {
    requestFrame: callback => win.requestAnimationFrame(callback),
    cancelFrame: id => win.cancelAnimationFrame(id),
    now: () => win.performance.now(),
    matchMedia: query => win.matchMedia(query),
    scrollY: () => win.scrollY,
    viewportHeight: () => win.innerHeight,
    scrollHeight: () => win.document.documentElement.scrollHeight,
    onResize: listener => {
      win.addEventListener("resize", listener, { passive: true });
      return () => win.removeEventListener("resize", listener);
    },
    onScroll: listener => {
      win.addEventListener("scroll", listener, { passive: true });
      return () => win.removeEventListener("scroll", listener);
    },
    tabHidden: () => win.document.visibilityState === "hidden",
    onVisibilityChange: listener => {
      const handler = () => listener(win.document.visibilityState === "hidden");
      win.document.addEventListener("visibilitychange", handler);
      return () => win.document.removeEventListener("visibilitychange", handler);
    },
    onReducedMotionChange: listener => {
      const handler = (event: MediaQueryListEvent) => listener(event.matches);
      reduced.addEventListener("change", handler);
      return () => reduced.removeEventListener("change", handler);
    },
    setStyle: (target, property, value) => {
      const style = (target as unknown as HTMLElement).style;
      if (value === null) style.removeProperty(property);
      else style.setProperty(property, value);
    },
    setAttribute: (target, name, value) => {
      const element = target as unknown as HTMLElement;
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    },
    createIntersectionObserver: hasObserver
      ? (deliver, rootMargin) => new win.IntersectionObserver(entries => deliver(entries as unknown as ScrollEntry[]), { rootMargin, threshold: 0 }) as unknown as ScrollObserver
      : undefined,
    watch: (root, onChange) => {
      const observer = new win.MutationObserver(records => { if (records.some(record => record.addedNodes.length > 0)) onChange(); });
      observer.observe(root as unknown as Node, { childList: true, subtree: true });
      return observer;
    },
    onFocusIn: (root, listener) => {
      // Only focus the keyboard (or a text field) shows, which is :focus-visible. A pointer press on a waiting link focuses it too, and
      // showing it then would move it between the press and the release, so the click would miss.
      const handler = (event: FocusEvent) => listener(event.target instanceof win.Element && visibleFocus(event.target) ? (event.target as unknown as ScrollElement) : null);
      (root as unknown as Node).addEventListener("focusin", handler as EventListener);
      return () => (root as unknown as Node).removeEventListener("focusin", handler as EventListener);
    },
    setTimeout: (run, ms) => win.setTimeout(run, ms),
    clearTimeout: id => win.clearTimeout(id),
  };
}
