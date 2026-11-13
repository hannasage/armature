import { logTag, type Flavor } from "../engine/flavor";
import { guardedSetup } from "../engine/guard";

/** The two hooks every action takes beside the options of its controller. */
export interface ActionHooks<T> {
  /** Called with the controller when the node mounts, and with `null` when the node leaves. This is how a component gets the controller. */
  onReady?(controller: T | null): void;
  /** Called with the error of a failed start or a failed stop, in place of the log line. If it throws, the error of the hook is logged as well. */
  onError?(error: unknown, context: string): void;
}

/** What an action returns. It has `destroy` and no `update`: the options are read once, when the node mounts. Use `{#key}` to start again. */
export interface ActionResult {
  destroy(): void;
}

/**
 * The whole of every action: make the controller when the node mounts, and destroy it when the node leaves. A failure is logged once with the label
 * of the flavor, or given to `onError`, and the page keeps working. A start that fails after the controller exists (`onReady` throws) destroys it.
 * Svelte runs no action on the server, so nothing here runs there.
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
  const log = (error: unknown, where: string) => console.error(`${logTag(flavor)} ${where} failed.`, error);
  // The hook of the user can throw too. Its error is logged, and the original error is not lost.
  const report = onError
    ? (error: unknown, where: string) => {
        try {
          onError(error, where);
        } catch (hook) {
          log(hook, `${where} (onError)`);
          log(error, where);
        }
      }
    : undefined;
  const stop = guardedSetup(context, () => {
    const made = create(node);
    try {
      onReady?.(made);
    } catch (error) {
      try {
        made.destroy();
      } catch (again) {
        (report ?? log)(again, `${context} (while stopping)`);
      }
      // The component still holds the controller that onReady was given, if it kept it. Tell it the controller is gone.
      try {
        onReady?.(null);
      } catch (again) {
        (report ?? log)(again, `${context} (while stopping)`);
      }
      throw error;
    }
    return () => {
      let first: unknown;
      let failed = false;
      for (const step of [() => made.destroy(), () => onReady?.(null)]) {
        try {
          step();
        } catch (error) {
          // The first error goes to the guard, which reports it. A second one is reported here, so neither is lost.
          if (failed) (report ?? log)(error, `${context} (while stopping)`);
          else [first, failed] = [error, true];
        }
      }
      if (failed) throw first;
    };
  }, report, flavor as Flavor);
  return { destroy: stop };
}
