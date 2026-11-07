// Opens a draft pull request with a checked body. Safety class: remote-write.
//
//   node tools/pr-open.mjs --title <text> --body-file <file> --base <branch> [--dir <folder>] [--dry-run] [--json]
//
// The tool checks the body before it touches GitHub (see tools/lib/pr-body.mjs): the first line is a GitHub alert,
// at most 300 words, no contractions, the body ends with the footer line, and it holds no home path and no session link.
// It then runs `gh pr create --draft --base <branch> --title <text> --body-file <file>`. It only ever opens a DRAFT.
// There is no flag to open a ready pull request. A person or the merge gate marks it ready later.
// With --dry-run it checks the body and prints the command, and it does not call gh.
// Exit codes: 0 opened (or dry run passed), 1 the body or gh failed, 2 wrong use.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { parseArgs } from "node:util";
import { resolveFile, resolveWorkTree } from "./lib/paths.mjs";
import { failingLine, redact, show } from "./lib/text.mjs";
import { validateBody } from "./lib/pr-body.mjs";

const USAGE = [
  "Usage: node tools/pr-open.mjs --title <text> --body-file <file> --base <branch> [--dir <folder>] [--dry-run] [--json]",
  "Opens a DRAFT pull request. The body is checked first. Exit codes: 0 opened, 1 the body or gh failed, 2 wrong use.",
].join("\n");

function usageError(json, message) {
  if (json) console.log(JSON.stringify({ ok: false, status: "usage", exit: 2, message }));
  else console.error(`${message}\n${USAGE}`);
  return 2;
}

export function main(argv, env = process.env) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: { title: { type: "string" }, "body-file": { type: "string" }, base: { type: "string" }, dir: { type: "string" }, "dry-run": { type: "boolean" }, json: { type: "boolean" }, help: { type: "boolean" } },
    }));
  } catch (error) {
    return usageError(argv.includes("--json"), error instanceof Error ? error.message : String(error));
  }
  const json = values.json === true;
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const title = values.title?.trim() ?? "";
  if (title === "" || /[\r\n\0]/.test(title) || title.length > 256) return usageError(json, "--title is required, must be one line, and at most 256 characters");
  const base = values.base ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(base)) return usageError(json, "--base is required and must be a branch name");
  if (values["body-file"] === undefined) return usageError(json, "--body-file is required");
  const file = resolveFile(values["body-file"], 64 * 1024);
  if (!file.ok) return usageError(json, `--body-file: ${file.error}`);
  const folder = resolveWorkTree(values.dir ?? process.cwd());
  if (!folder.ok) return usageError(json, `--dir: ${folder.error}`);

  const problems = validateBody(readFileSync(file.path, "utf8"));
  if (problems.length > 0) {
    if (json) console.log(JSON.stringify({ ok: false, status: "invalid-body", exit: 1, problems }));
    else for (const problem of problems) console.log(`INVALID ${problem}`);
    return 1;
  }

  // --draft is always in the command. No option turns it off.
  const command = ["gh", "pr", "create", "--draft", "--base", base, "--title", title, "--body-file", file.path];
  if (!json) console.log(`$ ${show(command)}`);
  if (values["dry-run"]) {
    if (json) console.log(JSON.stringify({ ok: true, status: "dry-run", exit: 0, draft: true, command: show(command), url: null }));
    else console.log("Dry run: the body is valid and gh was not called.");
    return 0;
  }
  const result = spawnSync(command[0], command.slice(1), { cwd: folder.path, env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error !== undefined || result.status !== 0) {
    const line = result.error !== undefined ? `could not start gh: ${result.error.message}` : failingLine(result.stdout, result.stderr);
    if (json) console.log(JSON.stringify({ ok: false, status: "gh-failed", exit: 1, draft: true, command: show(command), failingLine: line }));
    else console.log(`FAILED gh pr create: ${line}`);
    return 1;
  }
  const url = redact(result.stdout.trim().split("\n").at(-1) ?? "");
  if (json) console.log(JSON.stringify({ ok: true, status: "pass", exit: 0, draft: true, command: show(command), url }));
  else console.log(url);
  return 0;
}

process.exit(main(process.argv.slice(2)));
