// Small text helpers for the tools.

/** Removes anything shaped like a token or a one-time-code flag from text that is about to be shown. */
export function redact(text) {
  return String(text)
    .replace(/npm_[A-Za-z0-9]{20,}/g, "[redacted]")
    .replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, "[redacted]")
    .replace(/(--otp[= ])\S+/g, "$1[redacted]");
}

/** The one line to show for a failed command: the first line that names an error, else the first line with text. */
export function failingLine(stdout, stderr) {
  const lines = `${stderr ?? ""}\n${stdout ?? ""}`.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  const pick = lines.find((line) => /error|fail|not ok|✗|×/i.test(line)) ?? lines[0] ?? "no output";
  return redact(pick.length > 300 ? `${pick.slice(0, 300)}...` : pick);
}

/** Shows a command the way a person would type it. */
export function show(command) {
  return command.map((part) => (/^[\w@%+=:,./-]+$/.test(part) ? part : `'${part.replaceAll("'", "'\\''")}'`)).join(" ");
}
