import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compile } from "svelte/compiler";
import { render } from "svelte/server";

// Svelte's own server path: `compile` with `generate: "server"` makes a component, and `render` from `svelte/server` turns it into a string.
// The compiled file is written to a temporary folder and loaded from there. Its two imports are pointed at absolute files, so it finds the
// Svelte runtime and the adapter source from any folder. The folder is removed afterwards.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SERVER_RUNTIME = fileURLToPath(import.meta.resolve("svelte/internal/server"));

/** Renders a component source to a string on the server. `use:` actions in it must not run. */
export async function renderOnServer(source: string, props: Record<string, unknown> = {}): Promise<string> {
  const { js } = compile(source, { generate: "server", filename: "Probe.svelte", dev: false });
  const code = js.code
    .replaceAll(/(["'])svelte\/internal\/server\1/g, JSON.stringify(SERVER_RUNTIME))
    .replaceAll(/(["'])@hannasage\/armature\/svelte\1/g, JSON.stringify(join(root, "src/svelte/index.ts")));
  const dir = mkdtempSync(join(tmpdir(), "armature-svelte-"));
  try {
    const file = join(dir, "Probe.js");
    writeFileSync(file, code);
    const module = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as { default: unknown };
    return (render as (component: unknown, options: { props: Record<string, unknown> }) => { body: string })(module.default, { props }).body;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The client output of a component, to check that its `use:` directive compiles to a call of the action. */
export function clientCodeOf(source: string): string {
  return compile(source, { generate: "client", filename: "Probe.svelte", dev: false }).js.code;
}
