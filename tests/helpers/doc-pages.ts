import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The rule of the stamped spec for the documentation: a number on a page is measured, not typed. Every page that this helper checks
// lists its figures. A figure is a piece of text on the page and a check that works the number out from the code, from a run of the
// code, or from a saved measurement. A number in the prose that no figure covers fails the page.
//
// What is not a figure, because it is not a measured number:
// - code: a fenced block or an inline code span. It is an example of the API. A block that shows the output of the API is checked by a
//   figure all the same, where the page has one.
// - the marker of an ordered list, and a date such as 2026-11-13.
// - the "3" of "3D".
// - the bare numbers 0 and 1, which on these pages are bounds and counts ("0 or more", "from 0 to 1", "1 number").

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const readDoc = (name: string): string => readFileSync(join(root, "docs", name), "utf8");

export interface Figure {
  /** The text on the page that holds the number. Every place it appears is covered. */
  text: string | RegExp;
  /** Works the number out and compares it with the text. It throws, through `expect`, when the two differ. */
  check: () => void | Promise<void>;
}

/** A number in prose: digits, with groups of three after a comma, and decimals. Not part of a word, a name such as G4, or a hex color. */
const NUMBER = /(?<![\w.#-])\d+(?:,\d{3})*(?:\.\d+)?/g;

/** The ranges of a text that are code: fenced blocks and inline code spans. */
function codeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const match of text.matchAll(/^ {0,3}(```|~~~)[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm)) ranges.push([match.index, match.index + match[0].length]);
  const inside = (at: number) => ranges.some(([start, end]) => at >= start && at < end);
  for (const match of text.matchAll(/`[^`\n]+`/g)) if (!inside(match.index)) ranges.push([match.index, match.index + match[0].length]);
  return ranges;
}

/** The ranges a rule leaves out: list markers, dates, and the "3" of "3D". */
function ruleRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const match of text.matchAll(/^\s*\d+\.(?= )/gm)) ranges.push([match.index, match.index + match[0].length]);
  for (const match of text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) ranges.push([match.index, match.index + match[0].length]);
  for (const match of text.matchAll(/\b3D\b/g)) ranges.push([match.index, match.index + 2]);
  return ranges;
}

const allMatches = (text: string, pattern: string | RegExp): Array<[number, number]> => {
  const regex = typeof pattern === "string" ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g") : new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  return [...text.matchAll(regex)].map((match) => [match.index, match.index + match[0].length]);
};

/** The numbers in the prose of a page that no figure covers, each with its line number and its line. */
export function uncovered(text: string, figures: readonly Figure[]): string[] {
  const skip = [...codeRanges(text), ...ruleRanges(text), ...figures.flatMap((figure) => allMatches(text, figure.text))];
  const covered = (start: number, end: number) => skip.some(([from, to]) => start >= from && end <= to);
  const lines = text.split("\n");
  return [...text.matchAll(NUMBER)]
    .filter((match) => !["0", "1"].includes(match[0]))
    .filter((match) => !covered(match.index, match.index + match[0].length))
    .map((match) => {
      const line = text.slice(0, match.index).split("\n").length;
      return `line ${line}: "${match[0]}" in: ${lines[line - 1].trim()}`;
    });
}

/** Defines the tests of one page: no number goes unchecked, every figure is on the page, and every figure holds. */
export function checkPage(name: string, figures: readonly Figure[]): void {
  const text = readDoc(name);
  describe(`docs/${name}`, () => {
    it("has no number in its prose that a figure does not check", () => {
      expect(uncovered(text, figures)).toEqual([]);
    });
    it.each(figures.map((figure) => [String(figure.text), figure] as const))("holds the figure %s, as the code works it out", async (_label, figure) => {
      expect(allMatches(text, figure.text).length, `the page has the text ${String(figure.text)}`).toBeGreaterThan(0);
      await figure.check();
    });
  });
}

/** The text under a heading, up to the next heading of the same level or higher. */
export function sectionOf(text: string, title: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^#{1,6} /.test(line) && line.replace(/^#+ /, "").trim() === title);
  if (start < 0) throw new Error(`no heading "${title}"`);
  const level = /^#+/.exec(lines[start])![0].length;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => new RegExp(`^#{1,${level}} `).test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/** The fenced code blocks of a text with the given language. */
export function blocksOf(text: string, language: string): string[] {
  return [...text.matchAll(new RegExp(`^\`\`\`${language}\\n([\\s\\S]*?)^\`\`\`$`, "gm"))].map((match) => match[1]);
}

/** A number written the way the pages write it: groups of three with commas. */
export const grouped = (n: number): string => n.toLocaleString("en-US");
