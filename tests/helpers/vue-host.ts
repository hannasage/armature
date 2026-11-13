import { createRenderer, h, ref, type Component, type Ref } from "vue";

/**
 * A Vue renderer with no DOM. Vue's own `createRenderer` takes the node operations from the caller, so a test mounts a real component, runs its
 * `onMounted` and `onBeforeUnmount` hooks, and unmounts it in Node. The nodes are `FakeElement`s.
 */
export class FakeElement {
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  text = "";
  listeners = new Map<string, Set<unknown>>();
  constructor(public tag: string) {}
  addEventListener(type: string, listener: unknown) {
    this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(listener));
  }
  removeEventListener(type: string, listener: unknown) {
    this.listeners.get(type)?.delete(listener);
  }
  get listenerCount() {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 100, height: 40 };
  }
}

const renderer = createRenderer<FakeElement, FakeElement>({
  patchProp: () => undefined,
  insert(child, parent, anchor) {
    child.parent = parent;
    const at = anchor ? parent.children.indexOf(anchor) : -1;
    if (at < 0) parent.children.push(child);
    else parent.children.splice(at, 0, child);
  },
  remove(child) {
    child.parent?.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = null;
  },
  createElement: (tag) => new FakeElement(tag),
  createText: (text) => Object.assign(new FakeElement("#text"), { text }),
  createComment: (text) => Object.assign(new FakeElement("#comment"), { text }),
  setText: (node, text) => void (node.text = text),
  setElementText: (node, text) => void (node.text = text),
  parentNode: (node) => node.parent,
  nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
});

export interface Mounted {
  root: FakeElement;
  /** The element the component's template ref points at. */
  element: () => FakeElement | null | undefined;
  unmount(): void;
}

/** Mounts a component that takes the template ref as a prop. `setup` runs the composable under test with that ref. */
export function mountWith(setup: (el: Ref<HTMLElement | null>) => void, options: { withRef?: boolean } = {}): Mounted {
  const el = ref<HTMLElement | null>(null);
  const Probe: Component = {
    setup() {
      setup(el);
      return () => h("div", options.withRef === false ? {} : { ref: el });
    },
  };
  const root = new FakeElement("root");
  renderer.render(h(Probe), root);
  return { root, element: () => el.value as unknown as FakeElement | null, unmount: () => renderer.render(null, root) };
}
