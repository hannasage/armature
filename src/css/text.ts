// How /css writes a number, and what it lets through from a caller's text. Every number is cut to 1,000,000,000 and written with at most 4 decimals,
// so a value never reaches the sheet as exponent text.

/** The largest number written. A larger one is cut to it. */
const MAX = 1e9;

/** Cuts a number to the range that is written, so a caller's format function never sees a value past it. */
const clamp = (value: number): number => Math.max(-MAX, Math.min(MAX, value));

/** A finite number as CSS text, with no exponent. A value that is not a finite number throws a TypeError that names `what`. */
export function num(value: unknown, what: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${what} must be a finite number.`);
  return String(Number(clamp(value).toFixed(4)));
}

/** The functions a written value may call. Anything else, such as `url(`, is refused. */
const FUNCTIONS = /^(calc|min|max|clamp|var|rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix|blur|brightness|contrast|saturate|hue-rotate|grayscale|sepia|invert|opacity|drop-shadow|inset|circle|ellipse|polygon)$/i;
/** A number written with an exponent. A hex color such as `#1e2` is not one. */
const EXPONENT = /(?<![\w#.-])[+-]?(?:\d+\.?\d*|\.\d+)[eE][+-]?\d+/;

/**
 * A value that a caller's `format` returned, checked before it is written. It may hold letters, digits, spaces, and `. , % ( ) # + - * /`.
 * Its parentheses must balance, it may call only the functions listed above, and it must hold no comment and no exponent number.
 * It cannot hold `;`, `{`, `}`, quotes, `\`, `<`, or `@`, so it cannot end a declaration, close a rule, or start another.
 */
export function safeValue(value: unknown, what: string): string {
  const bad = (reason: string): never => {
    throw new TypeError(`${what} ${reason}.`);
  };
  if (typeof value !== "string") return bad("must return text");
  if (!/^[\w .,%()#+*/-]*$/.test(value) || value.includes("/*") || value.includes("*/")) return bad("returned text with a character that is not allowed in a CSS value");
  let depth = 0;
  for (const ch of value) {
    depth += ch === "(" ? 1 : ch === ")" ? -1 : 0;
    if (depth < 0) return bad("returned text with a closing parenthesis that has no opening one");
  }
  if (depth !== 0) return bad("returned text with an opening parenthesis that is never closed");
  for (const match of value.matchAll(/([\w-]+)\s*\(/g)) if (!FUNCTIONS.test(match[1])) return bad(`returned a call of ${match[1]}(), which is not allowed`);
  if (EXPONENT.test(value)) return bad("returned a number written with an exponent");
  return value;
}
