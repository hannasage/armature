// Small text helpers shared by the tools and by scripts/release.mjs.

// Key names whose value is a secret. Used inside text ("token: x") and, in redactDeep, as the name of a field.
const KEY_NAMES = "_authToken|_auth|_password|access_token|authToken|client_secret|secret|token|password|api_?key";
// A value after a key: a double-quoted string (with escapes), a single-quoted string, or a run of non-space characters.
// Every repeat is bounded, so no input can make the matcher slow.
const VALUE = String.raw`(?:"(?:[^"\\]|\\.){0,2000}"|'(?:[^'\\]|\\.){0,2000}'|\S{1,2000})`;

const SECRET_PATTERNS = [
  // A key and a value in JSON, with escaped quotes, in double or single quotes.
  [new RegExp(String.raw`("(?:${KEY_NAMES})"\s*:\s*")(?:[^"\\]|\\.){0,2000}(")`, "gi"), "$1[redacted]$2"],
  [new RegExp(String.raw`('(?:${KEY_NAMES})'\s*:\s*')(?:[^'\\]|\\.){0,2000}(')`, "gi"), "$1[redacted]$2"],
  // A password or a token inside a URL, also when the password holds a slash or a second @, and a bare token as the user name.
  [/(\/\/[^\s/:@]{1,128}:)\S{0,512}@/g, "$1[redacted]@"],
  [/(\/\/)[A-Za-z0-9_.~-]{20,256}@/g, "$1[redacted]@"],
  // A header.
  [/(\bAuthorization:\s*)(?:(?:Basic|Bearer|Token|Digest)\s+)?\S{1,2000}/gi, "$1[redacted]"],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{1,2000}/gi, "$1[redacted]"],
  // An environment variable or a key in a config file (KEY=value, KEY: value, key = value), with or without quotes.
  [new RegExp(String.raw`(\b[A-Z][A-Z0-9_]{0,60}(?:TOKEN|SECRET|PASSWORD|API_?KEY)\s{0,8}[=:]\s{0,8})${VALUE}`, "g"), "$1[redacted]"],
  [new RegExp(String.raw`(\b(?:${KEY_NAMES})\s{0,8}[=:]\s{0,8})${VALUE}`, "gi"), "$1[redacted]"],
  // One-time-code flags.
  [/(\s--?(?:otp|one-time-password)(?:=|\s+))\S{1,200}/g, "$1[redacted]"],
  [/^(--?(?:otp|one-time-password)(?:=|\s+))\S{1,200}/g, "$1[redacted]"],
  // Tokens by their prefix.
  [/github_pat_[A-Za-z0-9_]{20,255}/g, "[redacted]"],
  [/gh[pousr]_[A-Za-z0-9]{20,255}/g, "[redacted]"],
  [/npm_[A-Za-z0-9]{20,255}/g, "[redacted]"],
  [/sk-ant-[A-Za-z0-9_-]{10,255}/g, "[redacted]"],
  [/sk-proj-[A-Za-z0-9_-]{10,255}/g, "[redacted]"],
  [/glpat-[A-Za-z0-9_-]{20,255}/g, "[redacted]"],
  [/xox[abposr]-[A-Za-z0-9-]{10,255}/g, "[redacted]"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[redacted]"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, "[redacted]"],
  [/\beyJ[A-Za-z0-9_-]{5,500}\.[A-Za-z0-9_-]{5,500}\.[A-Za-z0-9_-]{0,500}/g, "[redacted]"],
];

/** Removes anything shaped like a token, a bearer header, a password in a URL, or a one-time-code flag from text that is about to be shown. */
export function redact(text) {
  let out = String(text);
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

const SECRET_KEY = new RegExp(String.raw`^(?:${KEY_NAMES}|authorization)$`, "i");

/**
 * Redacts every string inside a value, one string at a time, and keeps the shape. Use it before JSON.stringify.
 * Each string is redacted on its own, so a token at the end of a field can not reach past the end of that field
 * and damage the JSON around it.
 */
export function redactDeep(value) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  // A field with a secret name is redacted whatever its value looks like.
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, typeof inner === "string" && SECRET_KEY.test(key) ? "[redacted]" : redactDeep(inner)]));
  return value;
}

/** One line of JSON for a result, with every string field redacted first. */
export function jsonLine(value) {
  return JSON.stringify(redactDeep(value));
}

/**
 * The one line to show for a failed command: the first line that names an error, else the first line with text.
 * The line is redacted first and cut second, so a token at the cut can not be left half shown.
 */
export function failingLine(stdout, stderr) {
  const lines = `${stderr ?? ""}\n${stdout ?? ""}`.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  const pick = redact(lines.find((line) => /error|fail|not ok|✗|×/i.test(line)) ?? lines[0] ?? "no output");
  return pick.length > 300 ? `${pick.slice(0, 300)}...` : pick;
}

/** Shows a command the way a person would type it. */
export function show(command) {
  return command.map((part) => (/^[\w@%+=:,./-]+$/.test(part) ? part : `'${part.replaceAll("'", "'\\''")}'`)).join(" ");
}
