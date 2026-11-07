// Runs the full gate set in order and reports the real exit code of each command. Safety class: local-write.
//
//   node tools/gates.mjs [--ci] [--bail] [--cwd <folder>] [--json]
//
// The gates are `npm run typecheck`, `lint`, `test`, `build`, and `check:pack`. With --ci, `npm ci` runs first.
// The tool prints one line per gate. A gate passes only when its exit code is 0, and a pass line never shows over another code.
// A gate that exits with another code prints its first failing line. With --bail the run stops at the first failure.
// The commands write to node_modules (npm ci) and dist (build) in the folder. Nothing is written to a remote.
// Exit codes: 0 every gate passed, 1 a gate failed, 2 wrong use.
import { spawnSync } from "node:child_process";
import process from "node:process";
import { parseArgs } from "node:util";
import { resolveWorkTree } from "./lib/paths.mjs";
import { failingLine } from "./lib/text.mjs";

const USAGE = "Usage: node tools/gates.mjs [--ci] [--bail] [--cwd <folder>] [--json]\nExit codes: 0 every gate passed, 1 a gate failed, 2 wrong use.";
const GATES = ["typecheck", "lint", "test", "build", "check:pack"];

function usageError(json, message) {
  if (json) console.log(JSON.stringify({ ok: false, status: "usage", exit: 2, message }));
  else console.error(`${message}\n${USAGE}`);
  return 2;
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
  if (!folder.ok) return usageError(values.json === true, folder.error);

  const commands = [...(values.ci ? [{ name: "ci", command: ["npm", "ci"] }] : []), ...GATES.map((name) => ({ name, command: ["npm", "run", name] }))];
  const results = [];
  for (const { name, command } of commands) {
    const result = spawnSync(command[0], command.slice(1), { cwd: folder.path, env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    const exit = result.status;
    const passed = exit === 0 && result.error === undefined;
    const gate = { name, command: command.join(" "), exit, signal: result.signal ?? null, ok: passed };
    if (!passed) gate.firstFailingLine = result.error !== undefined ? `could not start: ${result.error.message}` : failingLine(result.stdout, result.stderr);
    results.push(gate);
    if (!values.json) {
      const code = exit === null ? (result.error !== undefined ? "did not run" : `signal ${result.signal}`) : `exit ${exit}`;
      console.log(passed ? `PASS ${gate.command} (${code})` : `FAIL ${gate.command} (${code}) - ${gate.firstFailingLine}`);
    }
    if (!passed && values.bail) break;
  }
  const ok = results.every((gate) => gate.ok) && results.length === commands.length;
  if (values.json) console.log(JSON.stringify({ ok, status: ok ? "pass" : "fail", exit: ok ? 0 : 1, path: folder.path, gates: results }));
  else {
    const failed = results.filter((gate) => !gate.ok).map((gate) => gate.name);
    console.log(ok ? `Result: all ${results.length} gates passed` : `Result: failed - ${failed.join(", ")}`);
  }
  return ok ? 0 : 1;
}

process.exit(main(process.argv.slice(2)));
