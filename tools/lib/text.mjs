// Small text helpers shared by the tools and by scripts/release.mjs.

const SECRET_PATTERNS = [
  [/(\/\/[^\s/:@]+:)[^\s/@]+@/g, "$1[redacted]@"],
  [/sk-ant-[A-Za-z0-9_-]{10,}/g, "[redacted]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[redacted]"],
  [/("(?:_auth|_authToken|_password|token|password|apiKey|api_key)"\s*:\s*")[^"]*(")/gi, "$1[redacted]$2"],
  [/github_pat_[A-Za-z0-9_]{20,}/g, "[redacted]"],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, "[redacted]"],
  [/npm_[A-Za-z0-9]{20,}/g, "[redacted]"],
  [/\b(Authorization:\s*(?:Basic|Bearer|Token)\s+)\S+/gi, "$1[redacted]"],
  [/(_auth(?:Token)?=)\S+/gi, "$1[redacted]"],
  [/(_password=)\S+/gi, "$1[redacted]"],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]"],
  [/\b((?:NODE_AUTH_TOKEN|NPM_TOKEN|GH_TOKEN|GITHUB_TOKEN)=)\S+/g, "$1[redacted]"],
  [/(--otp[= ])\S+/g, "$1[redacted]"],
];

/** Removes anything shaped like a token, a bearer header, or a one-time-code flag from text that is about to be shown. */
export function redact(text) {
  let out = String(text);
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

/**
 * Redacts every string inside a value, one string at a time, and keeps the shape. Use it before JSON.stringify.
 * Each string is redacted on its own, so a token at the end of a field can not reach past the end of that field
 * and damage the JSON around it.
 */
export function redactDeep(value) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, redactDeep(inner)]));
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
