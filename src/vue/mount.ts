import { onBeforeUnmount, onMounted, shallowRef, type ShallowRef } from "vue";
import { logTag, type Flavor } from "../engine/flavor";
import { guardedSetup } from "../engine/guard";

/** What a composable reads: a template ref, or anything with a `value` that holds the element. */
export interface ElementRef {
  readonly value: HTMLElement | null | undefined;
}

/** What a composable returns. It holds state and no motion. */
export interface ControllerHandle<T> {
  /** The controller while the component is mounted. `null` before the mount, after the unmount, on the server, and after a failed start. */
  readonly controller: Readonly<ShallowRef<T | null>>;
  /** The error of a failed start, or of an empty ref at the mount. `undefined` otherwise. The error is also logged once, and the page keeps working. */
  readonly failed: Readonly<ShallowRef<Error | undefined>>;
}

/**
 * The whole of every composable: make the controller when the component mounts, and destroy it when the component unmounts.
 * The options are read once, at the mount. A failed start is logged once with the label of the flavor, as the React hooks do, and shows in `failed`.
 * On the server Vue runs no mount hook, so nothing here runs, and the handle holds `null`.
 */
export function useController<T extends { destroy(): void }>(
  target: ElementRef,
  part: string,
  options: { flavor?: Flavor } | undefined,
  create: (element: HTMLElement) => T,
): ControllerHandle<T> {
  const controller = shallowRef(null) as ShallowRef<T | null>;
  const failed = shallowRef<Error | undefined>(undefined);
  let stop: (() => void) | undefined;

  onMounted(() => {
    const element = target.value;
    const flavor = options?.flavor;
    if (!element) {
      // The ref was not bound when the component mounted, for example the element sits behind a `v-if`. Say so once, and show it in `failed`.
      failed.value = new Error(`The ${part} has no element: the ref was empty when the component mounted.`);
      console.warn(`${logTag(flavor)} ${flavor?.name ?? "armature"} ${part} was skipped: the ref was empty when the component mounted.`);
      return;
    }
    stop = guardedSetup(`${flavor?.name ?? "armature"} ${part}`, () => {
      let made: T;
      try {
        made = create(element);
      } catch (error) {
        failed.value = error instanceof Error ? error : new Error(String(error));
        throw error;
      }
      controller.value = made;
      return () => {
        controller.value = null;
        made.destroy();
      };
    }, undefined, flavor as Flavor);
  });

  onBeforeUnmount(() => {
    stop?.();
    stop = undefined;
  });

  return { controller, failed };
}
