/**
 * Run the setup of an effect so that a throw (a missing `matchMedia`, a media query list with no `addEventListener`) cannot reach React's error
 * boundary and take the page down. The error is logged once with its context, and the page keeps what it already shows. It returns the
 * cleanup the setup gave back, or a no-op when the setup threw. A setup that threw part way is cleaned up by its own `finally`, not here.
 */
export function guardedSetup(context: string, setup: () => (() => void) | void, report: (error: unknown, context: string) => void = (error, where) => console.error(`[liquid-glass] ${where} failed to start and was skipped.`, error)): () => void {
  let cleanup: (() => void) | void;
  try {
    cleanup = setup();
  } catch (error) {
    report(error, context);
    return () => undefined;
  }
  return () => {
    try { cleanup?.(); } catch (error) { report(error, `${context} (while stopping)`); }
  };
}
