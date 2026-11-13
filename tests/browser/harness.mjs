// A shared start for the browser checks in this folder. They run on a machine with a real browser, and not in the gate container:
//   npm run build, then PLAYWRIGHT_CORE=<folder that holds playwright-core> node tests/browser/layout.pw.mjs
// PW_CHANNEL names an installed browser, such as "chrome", when the bundled Chromium is not there. A check prints one JSON object and
// exits 1 when an assertion fails. A check loads the built files of `dist` over a local server, so it tests what a user installs.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** Launches Chromium, headless, so no window opens. */
export async function launch() {
  const core = process.env.PLAYWRIGHT_CORE;
  const { chromium } = await import(core ? join(core, "playwright-core/index.mjs") : "playwright-core");
  const channel = process.env.PW_CHANNEL;
  return chromium.launch(channel ? { channel } : {});
}

/** Serves the built `dist` folder and a blank page, and returns the origin and a function that stops the server. */
export async function serve() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (path === "/") {
      res.setHeader("content-type", "text/html");
      res.end("<!doctype html><meta charset=utf-8><body></body>");
      return;
    }
    const file = normalize(join(root, path));
    if (!file.startsWith(join(root, "dist"))) {
      res.statusCode = 404;
      res.end();
      return;
    }
    try {
      res.setHeader("content-type", extname(file) === ".js" ? "text/javascript" : "text/plain");
      res.end(await readFile(file));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

export function report(results, problems) {
  console.log(JSON.stringify({ results, problems }, null, 2));
  process.exit(problems.length > 0 ? 1 : 0);
}
