// Opens a draft pull request with a checked body. Safety class: remote-write.
//
//   node tools/pr-open.mjs --title <text> --body-file <file> --base <branch> [--dir <folder>] [--expect-identity <login>] [--dry-run] [--json]
//
// The tool checks the body before it touches GitHub (see tools/lib/pr-body.mjs): the first line is a GitHub alert,
// at most 300 words, no contractions, the body ends with the footer line, and it holds no home path and no session link.
// It reads the body file once. The file must be inside the work tree or the temporary folder. The checked text goes to gh on
// standard input (`--body-file -`), so the file is not read a second time.
// It then runs `gh pr create --draft --base <branch> --title <text> --body-file -`. It only ever opens a DRAFT.
// gh must print a pull request URL on its last line. Without one the tool exits 1, even when gh exits 0.
// --dir must name a folder in a git work tree. Git and gh read the configuration of that repository, so only use one you trust.
// There is no flag to open a ready pull request. A person or the merge gate marks it ready later.
// With --dry-run it checks the body and prints the command, and it does not call gh.
// Exit codes: 0 opened (or dry run passed), 1 the body or gh failed, 2 wrong use.
import { readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { sep } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { isMainModule } from "./lib/main.mjs";
import { resolveFile, resolveWorkTree } from "./lib/paths.mjs";
import { effectiveTimeout, runCommand } from "./lib/run-group.mjs";
import { failingLine, jsonLine, redact, show } from "./lib/text.mjs";
import { validateBody, validateTitle } from "./lib/pr-body.mjs";

const USAGE = [
  "Usage: node tools/pr-open.mjs --title <text> --body-file <file> --base <branch> [--dir <folder>] [--expect-identity <login>] [--dry-run] [--json]",
  "Opens a DRAFT pull request. The body is checked first. Exit codes: 0 opened, 1 the body, gh, or git failed, 2 wrong use.",
  "Note: --dir must name a folder in a git work tree. Git and gh read the configuration of that repository, so only use one you trust.",
  "Note: gh gets the full environment on purpose, because it needs its own login (its config folder and any token it uses). The tool prints the gh identity before it creates anything (a warning if gh can not read it, as with a GitHub App token), and stops gh after 2 minutes. If gh pr create times out, a PR may exist, so check before retrying.",
].join("\n");

function usageError(json, message, exit = 2) {
  if (json) console.log(jsonLine({ ok: false, status: exit === 2 ? "usage" : "fail", exit, message }));
  else console.error(redact(exit === 2 ? `${message}\n${USAGE}` : message));
  return exit;
}

export function main(argv, env = process.env) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: { title: { type: "string" }, "body-file": { type: "string" }, base: { type: "string" }, dir: { type: "string" }, "expect-identity": { type: "string" }, "dry-run": { type: "boolean" }, json: { type: "boolean" }, help: { type: "boolean" } },
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
  const folder = resolveWorkTree(values.dir ?? process.cwd());
  if (!folder.ok) return usageError(json, `--dir: ${folder.error}`, folder.gitFailed ? 1 : 2);
  const file = resolveFile(values["body-file"], 64 * 1024);
  if (!file.ok) return usageError(json, `--body-file: ${file.error}`);
  const roots = [folder.top, realpathSync(tmpdir())];
  if (!roots.some((root) => file.path === root || file.path.startsWith(root.endsWith(sep) ? root : root + sep))) {
    return usageError(json, "--body-file must be inside the work tree or the temporary folder");
  }

  const titleProblems = validateTitle(title);
  if (titleProblems.length > 0) {
    if (json) console.log(jsonLine({ ok: false, status: "invalid-title", exit: 1, problems: titleProblems }));
    else for (const problem of titleProblems) console.log(`INVALID ${problem}`);
    return 1;
  }

  // The file is read once. The text that is checked is the text that gh receives.
  const text = readFileSync(file.path, "utf8");
  const problems = validateBody(text);
  if (problems.length > 0) {
    if (json) console.log(jsonLine({ ok: false, status: "invalid-body", exit: 1, problems }));
    else for (const problem of problems) console.log(`INVALID ${problem}`);
    return 1;
  }

  // --draft is always in the command. No option turns it off.
  const command = ["gh", "pr", "create", "--draft", "--base", base, "--title", title, "--body-file", "-"];
  if (values["dry-run"]) {
    if (!json) console.log(`$ ${redact(show(command))}`);
    if (json) console.log(jsonLine({ ok: true, status: "dry-run", exit: 0, draft: true, command: show(command), url: null }));
    else console.log("Dry run: the body is valid and gh was not called.");
    return 0;
  }
  const timeout = effectiveTimeout(env, 2 * 60 * 1000);
  const warnings = [];
  const failure = (status, line, extra = {}, step = "gh pr create") => {
    if (json) console.log(jsonLine({ ok: false, status, exit: 1, draft: true, command: show(command), failingLine: line, ...(warnings.length > 0 ? { warnings } : {}), ...extra }));
    else {
      for (const warning of warnings) console.log(`WARNING ${redact(warning)}`);
      console.log(`FAILED ${step}: ${redact(line)}`);
    }
    return 1;
  };
  const describe = (result) => (result.timedOut ? `timed out after ${timeout} ms` : result.error !== null ? `could not start gh: ${result.error}` : failingLine(result.stdout, result.stderr));
  const mayExist = "a PR may exist: check before retrying";

  // Say which account gh uses before anything is created. A GitHub App token can not read it (403), and that case is only a
  // warning, unless --expect-identity asks for a proof. Any other failure stops the run, and a timeout is not waited for twice.
  // A login that was read must look like a login.
  const expected = values["expect-identity"];
  const whoCommand = ["gh", "api", "user", "--jq", ".login"];
  if (!json) console.log(`$ ${show(whoCommand)}`);
  const who = runCommand({ command: whoCommand, cwd: folder.path, env, timeout });
  let identity = null;
  if (who.timedOut || who.error !== null || who.status !== 0) {
    const forbidden = !who.timedOut && who.error === null && /\b403\b|Resource not accessible by integration/i.test(`${who.stderr}\n${who.stdout}`);
    if (expected !== undefined || !forbidden) return failure("gh-identity-failed", `could not read the gh identity: ${describe(who)}`, {}, "gh identity");
    warnings.push(`could not read the gh identity: ${describe(who)}`);
  } else {
    identity = redact(who.stdout.trim().split("\n").at(-1) ?? "");
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,38})(?:\[bot\])?$/.test(identity)) return failure("gh-identity-invalid", "gh printed an identity that is not a login", {}, "gh identity");
    if (expected !== undefined && identity.toLowerCase() !== expected.toLowerCase()) return failure("gh-identity-mismatch", `gh is signed in as ${identity}, not as ${expected}`, { identity }, "gh identity");
  }
  if (!json) {
    for (const warning of warnings) console.log(`WARNING ${redact(warning)}`);
    if (identity !== null) console.log(`gh identity: ${identity}`);
  }

  // --draft is always in the command. No option turns it off.
  if (!json) console.log(`$ ${show(command)}`);
  const result = runCommand({ command, cwd: folder.path, env, timeout, input: text });
  if (result.timedOut) return failure("gh-timeout", `${describe(result)}. ${mayExist}`, { identity });
  if (result.error !== null || result.status !== 0) return failure("gh-failed", `${describe(result)}. ${mayExist}`, { identity });
  const url = redact(result.stdout.trim().split("\n").at(-1) ?? "");
  if (!/^https:\/\/\S+\/pull\/\d+$/.test(url)) return failure("no-url", `gh printed no pull request URL on its last line (it printed: ${url === "" ? "nothing" : url.slice(0, 100)}). ${mayExist}`, { identity });
  if (json) console.log(jsonLine({ ok: true, status: "pass", exit: 0, draft: true, command: show(command), url, identity, ...(warnings.length > 0 ? { warnings } : {}) }));
  else console.log(url);
  return 0;
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));
