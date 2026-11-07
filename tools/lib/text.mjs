// Small text helpers shared by the tools and by scripts/release.mjs.

// Key names whose value is a secret. Used inside text ("token: x") and, in redactDeep, as the name of a field.
// Any name that ends in _key, _secret, _token, _password, or _passwd counts too (AWS_SECRET_ACCESS_KEY, MY_SERVICE_KEY).
const FIXED_NAMES = "_authToken|_auth|_password|passwd|private_?key|access_token|authToken|client_secret|secret|token|password|passphrase|accountkey|api[-_]?key";
const SUFFIX_NAMES = "[A-Za-z][A-Za-z0-9_]{0,60}(?:_key|_secret|_token|_password|_passwd)";
const KEY_NAMES = `${FIXED_NAMES}|${SUFFIX_NAMES}`;
// A value after a key: a double-quoted string (with escapes), a single-quoted string, or a run of non-space characters.
// Every repeat is bounded, so no input can make the matcher slow.
const VALUE = String.raw`(?:"(?:[^"\\]|\\.){0,2000}"|'(?:[^'\\]|\\.){0,2000}'|\S{1,2000})`;
// A flag word is not a secret ("secret=true"), so it stays readable. A number is kept out of this list on purpose: a PIN or a
// numeric password is a secret ("password=123456").
const PLAIN = /^(?:true|false|null|undefined|none)$/i;
const keepsValue = (value) => PLAIN.test(value.replace(/^["']|["']$/g, ""));

const SECRET_PATTERNS = [
  // A private key block, also when the end line is missing.
  [/-----BEGIN [A-Z ]{0,30}PRIVATE KEY-----[\s\S]{0,10000}?(?:-----END [A-Z ]{0,30}PRIVATE KEY-----|$)/g, "[redacted]"],
  // A key and a value in JSON, with escaped quotes, in double or single quotes, also when the closing quote is missing.
  [new RegExp(String.raw`("(?:${KEY_NAMES})"\s*:\s*")(?:[^"\\]|\\.){0,2000}("?)`, "gi"), "$1[redacted]$2"],
  [new RegExp(String.raw`('(?:${KEY_NAMES})'\s*:\s*')(?:[^'\\]|\\.){0,2000}('?)`, "gi"), "$1[redacted]$2"],
  // A password inside a URL: after the first colon of the user part, up to the @ that comes before the host. The password may hold
  // spaces and a second @. It may not hold a slash, so a URL with a port and a path stays readable. A bare token as the user name.
  // The password may hold a slash. Digits followed by a slash are a port and a path, and stay readable. Digits followed directly by
  // the @ are a password. A host in square brackets (an IPv6 address) is not a user name.
  [/(\/\/[^\s/:@[]{1,128}:)([^\s]{1,512})@(?=[A-Za-z0-9[])/g, (whole, head, password) => (/^\d+\//.test(password) ? whole : `${head}[redacted]@`)],
  [/(\/\/)[A-Za-z0-9_.~-]{20,256}@/g, "$1[redacted]@"],
  // Headers.
  [/(\bAuthorization:[ \t]*)[^\r\n]{1,2000}/gi, "$1[redacted]"],
  [/(\bx-api-key:\s*)\S{1,2000}/gi, "$1[redacted]"],
  [/(\b(?:Set-)?Cookie:[ \t]*)[^\r\n]{1,4000}/gi, "$1[redacted]"],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{1,2000}/gi, "$1[redacted]"],
  // An environment variable or a key in a config file (KEY=value, KEY: value, key = value), with or without quotes.
  [new RegExp(String.raw`(\b(?:${KEY_NAMES}|[A-Z][A-Z0-9]{0,60}(?:TOKEN|SECRET|PASSWORD))\s{0,8}[=:]\s{0,8})(${VALUE})`, "gi"), (whole, head, value) => (keepsValue(value) ? whole : `${head}[redacted]`)],
  // Flags that carry a one-time code or a secret.
  [/(\s--?(?:otp|one-time-password|token|password|pass|passphrase|secret|api-key|auth-token)(?:=|\s+))\S{1,200}/g, "$1[redacted]"],
  [/^(--?(?:otp|one-time-password|token|password|pass|passphrase|secret|api-key|auth-token)(?:=|\s+))\S{1,200}/g, "$1[redacted]"],
  // Tokens by their prefix.
  [/github_pat_[A-Za-z0-9_]{20,255}/g, "[redacted]"],
  [/gh[pousr]_[A-Za-z0-9]{20,255}/g, "[redacted]"],
  [/npm_[A-Za-z0-9]{20,255}/g, "[redacted]"],
  [/sk-ant-[A-Za-z0-9_-]{10,255}/g, "[redacted]"],
  [/sk-proj-[A-Za-z0-9_-]{10,255}/g, "[redacted]"],
  [/\bsk-[A-Za-z0-9_-]{20,255}/g, "[redacted]"],
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,255}/g, "[redacted]"],
  [/glpat-[A-Za-z0-9_-]{20,255}/g, "[redacted]"],
  [/whsec_[A-Za-z0-9]{20,255}/g, "[redacted]"],
  [/\bya29\.[A-Za-z0-9_-]{20,500}/g, "[redacted]"],
  [/AGE-SECRET-KEY-[A-Z0-9]{20,255}/g, "[redacted]"],
  [/hooks\.slack\.com\/services\/[A-Za-z0-9/]{10,255}/g, "hooks.slack.com/services/[redacted]"],
  [/xox[abposr]-[A-Za-z0-9-]{10,255}/g, "[redacted]"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[redacted]"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, "[redacted]"],
  [/\beyJ[A-Za-z0-9_-]{5,500}\.[A-Za-z0-9_-]{5,500}\.[A-Za-z0-9_-]{0,500}/g, "[redacted]"],
];

/** Removes anything shaped like a token, a bearer header, a cookie, a private key, a password in a URL, or a one-time-code flag from text that is about to be shown. */
export function redact(text) {
  let out = String(text);
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

const SECRET_KEY = new RegExp(String.raw`^(?:${KEY_NAMES}|authorization|cookie|set-cookie|x-api-key)$`, "i");

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
