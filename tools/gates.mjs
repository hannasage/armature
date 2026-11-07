// Runs the full gate set in order and reports the real exit code of each command. Safety class: local-write.
//
//   node tools/gates.mjs [--ci] [--bail] [--cwd <folder>] [--json]
//
// The gates are `npm run typecheck`, `lint`, `test`, `build`, and `check:pack`. With --ci, `npm ci` runs first.
// The tool prints one line per gate. A gate passes only when its exit code is 0, and a pass line never shows over another code.
// A gate that exits with another code prints its first failing line. With --bail the run stops at the first failure.
// The commands write to node_modules (npm ci) and dist (build) in the folder. Nothing is written to a remote.
// Exit codes: 0 every gate passed, 1 a gate failed, 2 wrong use.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { makeScratch, toolEnv } from "./lib/env.mjs";
import { isMainModule } from "./lib/main.mjs";
import { resolveWorkTree } from "./lib/paths.mjs";
import { effectiveTimeout, runCommand } from "./lib/run-group.mjs";
import { failingLine, jsonLine, redact } from "./lib/text.mjs";

const USAGE = [
  "Usage: node tools/gates.mjs [--ci] [--bail] [--cwd <folder>] [--json]",
  "Exit codes: 0 every gate passed, 1 a gate failed or git could not run, 2 wrong use.",
  "Note: --cwd must name a folder in a git work tree. Git and npm read the configuration of that repository, so only use a repository you trust.",
].join("\n");
// The list of gates lives in release.config.json, the one source that scripts/release.mjs also reads. The config sits one folder
// above this tool. A missing or bad list stops the run.
function loadGates() {
  const file = join(dirname(fileURLToPath(import.meta.url)), "..", "release.config.json");
  const gates = JSON.parse(readFileSync(file, "utf8")).gates;
  if (!Array.isArray(gates) || gates.length === 0 || !gates.every((name) => typeof name === "string" && /^[a-z][a-z0-9:_-]*$/.test(name))) throw new Error("release.config.json needs a list of gate names in gates");
  return gates;
}

function usageError(json, message, exit = 2) {
  if (json) console.log(jsonLine({ ok: false, status: exit === 2 ? "usage" : "fail", exit, message }));
  else console.error(redact(exit === 2 ? `${message}\n${USAGE}` : message));
  return exit;
}

export function main(argv, env = process.env) {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, strict: true, allowPositionals: false, options: { ci: { type: "boolean" }, bail: { type: "boolean" }, cwd: { type: "string" }, json: { type: "boolean" }, help: { type: "boolean" } } }));
  } catch (error) {
    return usageError(argv.includes("--json"), error instanceof Error ? error.message : String(error));
  }
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const folder = resolveWorkTree(values.cwd ?? process.cwd());
  if (!folder.ok) return usageError(values.json === true, folder.error, folder.gitFailed ? 1 : 2);

  let gates;
  try {
    gates = loadGates();
  } catch (error) {
    return usageError(values.json === true, `the gate list can not be read: ${error instanceof Error ? error.message : String(error)}`, 1);
  }
  const commands = [...(values.ci ? [{ name: "ci", command: ["npm", "ci"] }] : []), ...gates.map((name) => ({ name, command: ["npm", "run", name] }))];
  // The gates get an allowlisted environment and a throwaway HOME, so a token in the caller environment can not reach them.
  let scratch = null;
  const warnings = [];
  const results = [];
  try {
    scratch = makeScratch();
    const childEnv = toolEnv(env, scratch);
    // Each gate may run for 15 minutes. If it runs longer, the whole process group is killed. RELEASE_TIMEOUT_MS can shorten the limit.
    const timeout = effectiveTimeout(env, 15 * 60 * 1000);
    for (const { name, command } of commands) {
      const result = runCommand({ command, cwd: folder.path, env: childEnv, timeout });
      const exit = result.timedOut ? 124 : result.status;
      const passed = exit === 0 && result.error === null;
      const gate = { name, command: command.join(" "), exit, signal: result.signal ?? null, ok: passed };
      if (!passed) gate.firstFailingLine = result.timedOut ? `timed out after ${timeout} ms` : result.error !== null ? `could not start: ${result.error}` : failingLine(result.stdout, result.stderr);
      results.push(gate);
      if (!values.json) {
        const code = exit === null ? (result.error !== null ? "did not run" : `signal ${result.signal}`) : `exit ${exit}`;
        console.log(passed ? `PASS ${gate.command} (${code})` : `FAIL ${gate.command} (${code}) - ${gate.firstFailingLine}`);
      }
      if (!passed && values.bail) break;
    }
  } catch (error) {
    // A failure to make the scratch folder, or any other surprise, is a failed result and not a crash.
    results.push({ name: "setup", command: "setup", exit: null, signal: null, ok: false, firstFailingLine: redact(error instanceof Error ? error.message : String(error)) });
  } finally {
    try {
      scratch?.remove();
    } catch (error) {
      warnings.push(`could not remove the scratch folder: ${redact(error instanceof Error ? error.message : String(error))}`);
    }
  }
  for (const warning of warnings) if (!values.json) console.log(`WARNING ${warning}`);
  const ok = results.every((gate) => gate.ok) && results.length === commands.length;
  if (!ok && results.some((gate) => gate.name === "setup") && !values.json) console.log(`FAIL setup - ${results.at(-1).firstFailingLine}`);
  if (values.json) console.log(jsonLine({ ok, status: ok ? "pass" : "fail", exit: ok ? 0 : 1, path: folder.path, gates: results, ...(warnings.length > 0 ? { warnings } : {}) }));
  else {
    const failed = results.filter((gate) => !gate.ok).map((gate) => gate.name);
    console.log(ok ? `Result: all ${results.length} gates passed` : `Result: failed - ${failed.join(", ")}`);
  }
  return ok ? 0 : 1;
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));
