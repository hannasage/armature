// Path arguments for the tools. Every path a tool takes goes through one of these two functions first.
// Each one resolves the value to an absolute path, follows links to the real path, and refuses what does not fit.
import { spawnSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

function checkText(input) {
  if (typeof input !== "string" || input.trim() === "") return "the path is empty or is not text";
  if (input.includes("\0")) return "the path holds a null byte";
  return null;
}

/**
 * Resolves a folder that must be inside a git work tree. On success it returns `{ ok: true, path, top }`.
 * `path` is the real path of the folder. `top` is the top folder of its work tree.
 * It refuses an empty value, a path that does not exist, a file, and a folder that is not in a git work tree.
 */
export function resolveWorkTree(input) {
  const bad = checkText(input);
  if (bad !== null) return { ok: false, error: bad };
  let path;
  try {
    path = realpathSync(resolve(input));
    if (!statSync(path).isDirectory()) return { ok: false, error: `${path} is not a folder` };
  } catch {
    return { ok: false, error: `${resolve(input)} does not exist` };
  }
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  const inside = spawnSync("git", ["-C", path, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8", env });
  if (inside.status !== 0 || inside.stdout.trim() !== "true") return { ok: false, error: `${path} is not inside a git work tree` };
  const top = spawnSync("git", ["-C", path, "rev-parse", "--show-toplevel"], { encoding: "utf8", env });
  if (top.status !== 0) return { ok: false, error: `${path} is not inside a git work tree` };
  return { ok: true, path, top: realpathSync(top.stdout.trim()) };
}

/** Resolves a regular file no larger than `maxBytes`. On success it returns `{ ok: true, path }`. */
export function resolveFile(input, maxBytes = 1024 * 1024) {
  const bad = checkText(input);
  if (bad !== null) return { ok: false, error: bad };
  try {
    const path = realpathSync(resolve(input));
    const info = statSync(path);
    if (!info.isFile()) return { ok: false, error: `${path} is not a file` };
    if (info.size > maxBytes) return { ok: false, error: `${path} is larger than ${maxBytes} bytes` };
    return { ok: true, path };
  } catch {
    return { ok: false, error: `${resolve(input)} does not exist` };
  }
}
