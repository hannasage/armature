// Runs a command with a time limit and kills the whole process group when the limit passes.
//
// `spawnSync` with a timeout kills only the child. A grandchild (npm starts node, git starts ssh) can live on and keep the
// output pipes open, and then the caller waits for ever. So a command that may start grandchildren runs through a small runner
// process. The runner starts the command in its own process group. On a timeout it sends SIGTERM to the group, then SIGKILL,
// so every process in the group dies. The caller still waits with one synchronous call.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);

/** The limit in ms. RELEASE_TIMEOUT_MS in the given environment can only make it shorter. A test uses it to see a timeout. */
export function effectiveTimeout(env, ms) {
  const override = Number(env?.RELEASE_TIMEOUT_MS);
  return Number.isInteger(override) && override > 0 ? Math.min(ms, override) : ms;
}

/** True for a command that may start grandchildren and so needs the group runner. */
export function usesGroup(command) {
  const [name, sub] = command;
  if (name === "npm" && sub === "view") return false;
  if (name === "npm" || name === "node" || name === "gh") return true;
  if (name === "git") return ["fetch", "ls-remote", "push", "pull", "clone"].includes(sub);
  return false;
}

/**
 * Runs `spec = { command, cwd, env, timeout, input? }` and waits for it.
 * It returns `{ status, signal, stdout, stderr, timedOut, error }`. `status` is the exit code, or null when there was none.
 * `timedOut` is true when the limit passed. `error` is a message when the command could not start.
 */
export function runCommand(spec) {
  const limit = spec.timeout;
  if (!usesGroup(spec.command)) {
    const result = spawnSync(spec.command[0], spec.command.slice(1), {
      cwd: spec.cwd,
      env: spec.env,
      encoding: "utf8",
      input: spec.input,
      maxBuffer: spec.maxBuffer ?? 256 * 1024 * 1024,
      timeout: limit,
    });
    return {
      status: result.status,
      signal: result.signal,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      timedOut: result.error?.code === "ETIMEDOUT",
      error: result.error !== undefined && result.error.code !== "ETIMEDOUT" ? String(result.error.message) : null,
      errorCode: result.error !== undefined && result.error.code !== "ETIMEDOUT" ? (result.error.code ?? null) : null,
    };
  }
  const outer = spawnSync(process.execPath, [HERE, "--runner"], {
    input: JSON.stringify(spec),
    encoding: "utf8",
    maxBuffer: spec.maxBuffer ?? 512 * 1024 * 1024,
    // The runner enforces the real limit. This one only stops a runner that is stuck.
    timeout: limit + 20000,
    env: {},
  });
  try {
    return JSON.parse(outer.stdout);
  } catch {
    return { status: null, signal: outer.signal, stdout: "", stderr: "", timedOut: outer.error?.code === "ETIMEDOUT", error: "the command runner failed", errorCode: outer.error?.code ?? null };
  }
}

function runner() {
  const spec = JSON.parse(readFileSync(0, "utf8"));
  const out = { status: null, signal: null, stdout: "", stderr: "", timedOut: false, error: null, errorCode: null };
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    process.stdout.write(JSON.stringify(out), () => process.exit(0));
  };
  const child = spawn(spec.command[0], spec.command.slice(1), {
    cwd: spec.cwd,
    env: spec.env,
    detached: true,
    stdio: [spec.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  const killGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      // The group is already gone.
    }
  };
  child.on("error", (error) => {
    out.error = String(error.message);
    out.errorCode = error.code ?? null;
    finish();
  });
  child.stdout.setEncoding("utf8").on("data", (chunk) => (out.stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (out.stderr += chunk));
  if (spec.input !== undefined) {
    child.stdin.on("error", () => {});
    child.stdin.end(spec.input);
  }
  const timer = setTimeout(() => {
    out.timedOut = true;
    killGroup("SIGTERM");
    setTimeout(() => killGroup("SIGKILL"), 2000).unref();
    // A process in another group could still hold the pipes. Do not wait for it for ever.
    setTimeout(finish, 5000).unref();
  }, spec.timeout);
  child.on("close", (status, signal) => {
    clearTimeout(timer);
    out.status = status;
    out.signal = signal;
    if (out.timedOut) killGroup("SIGKILL");
    finish();
  });
  // A Ctrl-C or a kill of the runner takes the child group with it.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      killGroup("SIGKILL");
      process.exit(130);
    });
  }
}

if (process.argv[2] === "--runner" && realpathSync(process.argv[1]) === realpathSync(HERE)) runner();
