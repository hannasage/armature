import { logTag, type Flavor } from "./flavor";

/**
 * Run the setup of an effect so that a throw (a missing `matchMedia`, a media query list with no `addEventListener`) cannot reach React's error
 * boundary and take the page down. The error is logged once with its context, and the page keeps what it already shows. It returns the
 * cleanup the setup gave back, or a no-op when the setup threw. The returned function runs the cleanup once, and a second call does nothing. A setup that threw part way is cleaned up by its own `finally`, not here.
 *
 * The default log line starts with the flavor's label, such as `[liquid-glass]`. A `report` function replaces the log line. Pass `undefined`
 * for `report` to use the default.
 */
export function guardedSetup(context: string, setup: () => (() => void) | void, report: ((error: unknown, context: string) => void) | undefined, flavor: Flavor): () => void {
  const complain = report ?? ((error: unknown, where: string) => console.error(`${logTag(flavor)} ${where} failed to start and was skipped.`, error));
  let cleanup: (() => void) | void;
  try {
    cleanup = setup();
  } catch (error) {
    complain(error, context);
    return () => undefined;
  }
  return () => {
    const run = cleanup;
    cleanup = undefined;
    try { run?.(); } catch (error) { complain(error, `${context} (while stopping)`); }
  };
}
