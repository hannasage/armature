// The escapes for text that is written into CSS. A name goes through `escapeIdent` and a quoted value through `escapeString`, so one hostile
// character cannot end the name, close the rule, or start a new one. Neither function writes a literal `<`, so a sheet is safe inside a `<style>` element.

const hex = (code: number) => `\\${code.toString(16)} `;

const text = (value: unknown, what: string): string => {
  if (typeof value !== "string") throw new TypeError(`${what} must be text.`);
  return value;
};

/** A CSS identifier for a name, by the rule of `CSS.escape`. A `<` and every control character is a hex escape, and a NUL is the replacement character. */
export function escapeIdent(name: string): string {
  const value = text(name, "A CSS name");
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    const digit = code >= 0x30 && code <= 0x39;
    if (code === 0) out += "�";
    else if (code < 0x20 || code === 0x7f || code === 0x3c || (digit && (i === 0 || (i === 1 && value.charCodeAt(0) === 0x2d)))) out += hex(code);
    else if (code === 0x2d && value.length === 1) out += "\\-";
    else if (code >= 0x80 || code === 0x2d || code === 0x5f || digit || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) out += value[i];
    else out += `\\${value[i]}`;
  }
  return out;
}

/** A double-quoted CSS string. The quote, the backslash, `<`, and every control character are escaped. */
export function escapeString(value: string): string {
  const input = text(value, "A CSS string");
  let out = '"';
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code === 0) out += "�";
    else if (code < 0x20 || code === 0x7f || code === 0x3c) out += hex(code);
    else out += code === 0x22 || code === 0x5c ? `\\${input[i]}` : input[i];
  }
  return `${out}"`;
}
