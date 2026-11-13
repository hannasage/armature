import { describe, expect, it } from "vitest";
import { blocksOf, fenceLabels, NUMBER, uncovered } from "../helpers/doc-pages";

// The helper that the page tests share: the one fence pattern, and the scan for numerals.

describe("the fence pattern", () => {
  it("reads ``` and ~~~ fences with up to 3 spaces of indent, and their labels", () => {
    const text = "a\n```ts\nx\n```\n   ~~~css\ny\n   ~~~\n```\nz\n```\n";
    expect(fenceLabels(text)).toEqual(["ts", "css", ""]);
    expect(blocksOf(text, "ts")).toEqual(["x\n"]);
    expect(blocksOf(text, "css")).toEqual(["y\n"]);
  });
  it("does not close a ``` block with ~~~, or read a fence with 4 spaces of indent", () => {
    expect(blocksOf("```ts\nx\n~~~\ny\n```\n", "ts")).toEqual(["x\n~~~\ny\n"]);
    expect(fenceLabels("    ```ts\nx\n    ```\n")).toEqual([]);
  });
  it("leaves the numbers inside a fenced block of either kind out of the scan", () => {
    expect(uncovered("~~~\n42\n~~~\n", [])).toEqual([]);
    expect(uncovered("```\n42\n```\n", [])).toEqual([]);
  });
});

describe("the numeral scan", () => {
  const numbers = (text: string) => [...text.matchAll(NUMBER)].map((match) => match[0]);
  it("reads groups, decimals, signs, a decimal with no leading digit, and the second number of a range", () => {
    expect(numbers("1,000,000 and 0.25 and -3 and .5 and 10-20")).toEqual(["1,000,000", "0.25", "-3", ".5", "10", "20"]);
  });
  it("skips names, hex colors, and the inside of a word", () => {
    expect(numbers("G4 x1 #636363 3D")).toEqual(["3"]);
  });
  it("flags a number in prose and in inline code that no figure covers", () => {
    expect(uncovered("It takes 42 ms and `.5`.", [])).toHaveLength(2);
  });
});
