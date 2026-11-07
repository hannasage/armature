// Small text helpers shared by the tools and by scripts/release.mjs.

const SECRET_PATTERNS = [
  [/github_pat_[A-Za-z0-9_]{20,}/g, "[redacted]"],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, "[redacted]"],
  [/npm_[A-Za-z0-9]{20,}/g, "[redacted]"],
  [/(_authToken=)\S+/gi, "$1[redacted]"],
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
