// The rules for the body of a pull request. `tools/pr-open.mjs` checks them before it calls GitHub.
// No rule uses a pattern that can backtrack badly: the checks are string compares, a split on white space, and short fixed patterns.

export const FOOTER = "🤖 Generated with [Claude Code](https://claude.com/claude-code)";
export const ALERTS = ["NOTE", "TIP", "IMPORTANT", "CAUTION", "WARNING"].map((type) => `> [!${type}]`);
export const MAX_WORDS = 300;

// A letter, an apostrophe (straight, curly, or modifier), then one of the contraction endings, and no letter after.
// A possessive such as "Hanna's" has the same shape as "it's", so it counts too. Write "the name of Hanna" instead.
const CONTRACTION = /[A-Za-z]['’ʼ](?:t|s|re|ve|ll|d|m)(?![A-Za-z])/;
const HOME_PATHS = [/\/Users\/[^\s/]+/, /\/home\/[^\s/]+/, /[A-Za-z]:\\Users\\[^\s\\]+/];
const SESSION_LINKS = [/claude\.ai\/(?:code|chat|share)\b/i, /\bsession_[A-Za-z0-9]{8,}/];

export function countWords(text) {
  let count = 0;
  for (const word of text.split(/\s+/)) if (word !== "") count += 1;
  return count;
}

/** Returns the list of problems with a body. An empty list means the body is allowed. */
export function validateBody(text) {
  if (typeof text !== "string" || text.trim() === "") return ["the body is empty or is not text"];
  const problems = [];
  if (text.includes("\r")) problems.push("the body has carriage returns (CRLF line ends). Use line feeds only");
  const newline = text.indexOf("\n");
  const first = newline === -1 ? text : text.slice(0, newline);
  if (!ALERTS.includes(first)) problems.push("the first line must be a GitHub alert, such as > [!NOTE], > [!TIP], > [!IMPORTANT], > [!CAUTION], or > [!WARNING]");
  const words = countWords(text);
  if (words > MAX_WORDS) problems.push(`the body has ${words} words, and the limit is ${MAX_WORDS}`);
  if (CONTRACTION.test(text)) problems.push("the body has a contraction (such as don't, it's, or we're). Write the words out");
  // One final line feed is allowed. Nothing else may follow the footer line: not a blank line, not a space.
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (body !== FOOTER && !body.endsWith(`\n${FOOTER}`)) problems.push(`the body must end with the line: ${FOOTER}`);
  if (HOME_PATHS.some((pattern) => pattern.test(text))) problems.push("the body has a home path (such as /Users/name). Remove it");
  if (SESSION_LINKS.some((pattern) => pattern.test(text))) problems.push("the body has a session link. Remove it");
  return problems;
}
