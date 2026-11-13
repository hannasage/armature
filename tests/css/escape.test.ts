import { describe, expect, it } from "vitest";
import { escapeIdent, escapeString } from "../../src/css/escape";

// The escapes follow the CSS Object Model rule for `CSS.escape`. A name that is written into a selector, a property, or a keyframes rule goes through
// `escapeIdent`, so it stays one name whatever it holds. `<` is written as a hex escape, so no `</style>` can reach a page.

describe("escapeIdent", () => {
  it("leaves a plain name alone", () => {
    expect(escapeIdent("lqg-press_2")).toBe("lqg-press_2");
    expect(escapeIdent("--lqg-press")).toBe("--lqg-press");
    expect(escapeIdent("data-é")).toBe("data-é");
  });

  it("escapes a leading digit, a lone hyphen, and a digit after a leading hyphen", () => {
    expect(escapeIdent("1a")).toBe("\\31 a");
    expect(escapeIdent("-")).toBe("\\-");
    expect(escapeIdent("-1")).toBe("-\\31 ");
  });

  it("escapes every character that could end a name", () => {
    expect(escapeIdent("a b")).toBe("a\\ b");
    expect(escapeIdent("a}{;:,>")).toBe("a\\}\\{\;\\:\\,\\>");
    expect(escapeIdent('a"\'()[]\\/*')).toBe("a\\\"\\'\\(\\)\\[\\]\\\\\\/\\*");
  });

  it("writes a control character as a hex escape, and a NUL as the replacement character", () => {
    expect(escapeIdent("a\nb")).toBe("a\\a b");
    expect(escapeIdent("a\u007fb")).toBe("a\\7f b");
    expect(escapeIdent("a\u0000b")).toBe("a�b");
  });

  it("never writes a literal less-than sign", () => {
    expect(escapeIdent("</style>")).toBe("\\3c \\/style\\>");
    expect(escapeIdent("a<b")).not.toContain("<");
  });

  it("is applied to text only: a value that is not text throws a TypeError", () => {
    expect(() => escapeIdent(undefined as never)).toThrow(TypeError);
    expect(() => escapeIdent(5 as never)).toThrow(TypeError);
  });
});

describe("escapeString", () => {
  it("quotes a plain text", () => {
    expect(escapeString("ready")).toBe('"ready"');
  });

  it("escapes the quote, the backslash, the newline, and every control character", () => {
    expect(escapeString('a"b')).toBe('"a\\"b"');
    expect(escapeString("a\\b")).toBe('"a\\\\b"');
    expect(escapeString("a\nb")).toBe('"a\\a b"');
    expect(escapeString("a\u0001b")).toBe('"a\\1 b"');
  });

  it("never writes a literal less-than sign", () => {
    expect(escapeString("</style><script>")).toBe('"\\3c /style>\\3c script>"');
  });

  it("throws a TypeError for a value that is not text", () => {
    expect(() => escapeString(null as never)).toThrow(TypeError);
  });
});
