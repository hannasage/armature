// Environments for child processes. A child gets a short allowlist of variables and never a copy of the whole environment,
// so a token in the caller environment can not reach npm, a gate, or a script by accident.
// The idea is the same as the Projection UI release tool: a throwaway HOME, no user npm config, no update notifier.
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Copies the named variables that exist. */
export function pick(env, names) {
  const copy = {};
  for (const name of names) if (env[name] !== undefined) copy[name] = env[name];
  return copy;
}

/**
 * The folder that holds the scratch folder. The Node permission flag takes a list that is split at commas and may read a star
 * as a pattern, so a path with a comma or a star is not safe. If the temporary folder has one, use /tmp. If that fails too, stop.
 */
function safeBase() {
  for (const candidate of [tmpdir(), "/tmp"]) {
    try {
      const real = realpathSync(candidate);
      if (!/[,*]/.test(real)) return real;
    } catch {
      // Try the next one.
    }
  }
  throw new Error("the temporary folder path holds a comma or an asterisk, which the Node permission flag can not take. Set TMPDIR to a plain path");
}

/**
 * A throwaway folder with a HOME, an npm cache, and an empty npm config file. `remove` deletes all of it.
 * Callers make one when they first need it and remove it when they finish.
 */
export function makeScratch(hooks = {}) {
  const dir = realpathSync(mkdtempSync(join(safeBase(), "release-scratch-")));
  try {
    const home = join(dir, "home");
    const cache = join(dir, "cache");
    const npmrc = join(dir, "npmrc");
    // npm refuses to load one file as both the user config and the global config, so each gets its own empty file.
    const globalrc = join(dir, "globalrc");
    hooks.onCreated?.(dir); // for a test: it can throw, to see that the folder is removed
    mkdirSync(home);
    mkdirSync(cache);
    writeFileSync(npmrc, "");
    writeFileSync(globalrc, "");
    // npm looks for a project by walking up from the folder it runs in. A package.json here stops the walk at the scratch folder,
    // so an .npmrc in a folder above the temporary folder is never read.
    writeFileSync(join(dir, "package.json"), '{"name":"release-scratch","version":"0.0.0","private":true}\n');
    return { dir, home, cache, npmrc, globalrc, remove: () => rmSync(dir, { recursive: true, force: true }) };
  } catch (error) {
    // Nothing is left behind when a step after mkdtemp fails. If the cleanup fails too, the first error is the one that is thrown.
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // The original error matters more.
    }
    throw error;
  }
}

/**
 * The base: PATH, LANG, TERM, and CI, and nothing else. NODE_AUTH_TOKEN, NPM_TOKEN, GH_TOKEN, GITHUB_TOKEN, one-time-code
 * settings, SSH_AUTH_SOCK, AWS_* and ANTHROPIC_* are all left out because they are not on the list.
 */
export function baseEnv(env) {
  return pick(env, ["PATH", "LANG", "TERM", "CI"]);
}

/** For `npm ci`, the gates, and the publish dry run. HOME is throwaway and the user npm config is off. The real npm cache is kept, because it holds public downloads. */
export function toolEnv(env, scratch) {
  const realHome = env.HOME ?? "";
  const cache = env.npm_config_cache ?? (realHome && existsSync(join(realHome, ".npm")) ? join(realHome, ".npm") : scratch.cache);
  return {
    ...baseEnv(env),
    HOME: scratch.home,
    NPM_CONFIG_USERCONFIG: scratch.npmrc,
    NPM_CONFIG_GLOBALCONFIG: scratch.globalrc,
    npm_config_cache: cache,
    npm_config_update_notifier: "false",
    NO_UPDATE_NOTIFIER: "1",
  };
}

/** For `npm view` and for the install in verify. HOME, the cache, and both npm config files are all inside the scratch folder. */
export function viewEnv(env, scratch) {
  return {
    ...baseEnv(env),
    npm_config_prefix: scratch.dir,
    HOME: scratch.home,
    NPM_CONFIG_USERCONFIG: scratch.npmrc,
    NPM_CONFIG_GLOBALCONFIG: scratch.globalrc,
    npm_config_cache: scratch.cache,
    npm_config_loglevel: "error",
    npm_config_fetch_retries: "1",
    npm_config_update_notifier: "false",
    NO_UPDATE_NOTIFIER: "1",
  };
}

/** For git. It needs the real HOME for its config and keys, and the agent socket for ssh. It never prompts. */
export function gitEnv(env) {
  return {
    ...pick(env, ["PATH", "HOME", "LANG", "TERM", "SSH_AUTH_SOCK", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM"]),
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    // A person's own ssh command is kept. BatchMode, which stops every prompt, is added only when there is none.
    GIT_SSH_COMMAND: env.GIT_SSH_COMMAND || "ssh -o BatchMode=yes",
  };
}

/** Config switches that stop a repository from running a program of its own when git reads it: no fsmonitor, no hooks, no external ssh. */
export const GIT_SAFE_CONFIG = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "core.sshCommand=false", "-c", "protocol.ext.allow=never"];
