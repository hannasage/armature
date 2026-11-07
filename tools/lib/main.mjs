// True when the module with this URL is the one node was asked to run. A tool uses it so that a test can import the tool
// without the tool running and exiting.
import { realpathSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

export function isMainModule(moduleUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
