import { logTag, type Flavor } from "../engine/flavor";
import { guardedSetup } from "../engine/guard";

/** The two hooks every action takes beside the options of its controller. */
export interface ActionHooks<T> {
  /** Called with the controller when the node mounts, and with `null` when the node leaves. This is how a component gets the controller. */
  onReady?(controller: T | null): void;
  /** Called with the error of a failed start, in place of the log line. */
  onError?(error: unknown, context: string): void;
}

/** What an action returns. It has `destroy` and no `update`: the options are read once, when the node mounts. Use `{#key}` to start again. */
export interface ActionResult {
  destroy(): void;
}

/**
 * The whole of every action: make the controller when the node mounts, and destroy it when the node leaves. A failed start is logged once with
 * the label of the flavor, or given to `onError`, and the page keeps working. Svelte runs no action on the server, so nothing here runs there.
 */
export function act<T extends { destroy(): void }>(
  node: HTMLElement,
  part: string,
  options: ({ flavor?: Flavor } & ActionHooks<T>) | undefined,
  create: (element: HTMLElement) => T,
): ActionResult {
  const flavor = options?.flavor;
  const context = `${flavor?.name ?? "armature"} ${part}`;
  const { onReady, onError } = options ?? {};
  const stop = guardedSetup(context, () => {
    const made = create(node);
    if (onReady) {
      try {
        onReady(made);
      } catch (error) {
        (onError ?? ((e: unknown) => console.error(`${logTag(flavor)} ${context} onReady threw.`, e)))(error, `${context} (onReady)`);
      }
    }
    return () => {
      try {
        made.destroy();
      } finally {
        try {
          onReady?.(null);
        } catch {
          // The component's own hook failed while the node was leaving. The controller is already destroyed.
        }
      }
    };
  }, onError, flavor as Flavor);
  return { destroy: stop };
}
