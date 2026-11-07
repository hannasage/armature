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
 * A throwaway folder with a HOME, an npm cache, and an empty npm config file. `remove` deletes all of it.
 * Callers make one when they first need it and remove it when they finish.
 */
export function makeScratch() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "release-scratch-")));
  const home = join(dir, "home");
  const cache = join(dir, "cache");
  const npmrc = join(dir, "npmrc");
  mkdirSync(home);
  mkdirSync(cache);
  writeFileSync(npmrc, "");
  return { dir, home, cache, npmrc, remove: () => rmSync(dir, { recursive: true, force: true }) };
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
    NPM_CONFIG_GLOBALCONFIG: scratch.npmrc,
    npm_config_cache: cache,
    npm_config_update_notifier: "false",
    NO_UPDATE_NOTIFIER: "1",
  };
}

/** For `npm view` and for the install in verify. HOME, the cache, and both npm config files are all inside the scratch folder. */
export function viewEnv(env, scratch) {
  return {
    ...baseEnv(env),
    HOME: scratch.home,
    NPM_CONFIG_USERCONFIG: scratch.npmrc,
    NPM_CONFIG_GLOBALCONFIG: scratch.npmrc,
    npm_config_cache: scratch.cache,
    npm_config_loglevel: "error",
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
    GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
  };
}
