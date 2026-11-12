import { describe, expect, it } from "vitest";
import { numberKind, vectorKind } from "../../src/values";

describe("the number kind", () => {
  it("parses a finite number and rejects anything else with a TypeError", () => {
    expect(numberKind.parse(3)).toBe(3);
    expect(numberKind.parse(-0.5)).toBe(-0.5);
    for (const bad of [NaN, Infinity, "3", null, undefined, {}, [1]]) expect(() => numberKind.parse(bad), String(bad)).toThrow(TypeError);
    expect(() => numberKind.parse("3")).toThrow("A number value must be a finite number.");
  });

  it("splits into one component and joins again", () => {
    expect(numberKind.toArray(2)).toEqual([2]);
    expect(numberKind.fromArray([2])).toBe(2);
  });

  it("interpolates, measures distance, and serializes", () => {
    expect(numberKind.interpolate(10, 20, 0)).toBe(10);
    expect(numberKind.interpolate(10, 20, 0.25)).toBe(12.5);
    expect(numberKind.interpolate(10, 20, 1)).toBe(20);
    expect(numberKind.distance(3, -4)).toBe(7);
    expect(numberKind.serialize(1)).toBe("1");
    expect(numberKind.serialize(0.123456)).toBe("0.1235");
    expect(numberKind.serialize(-0.00001)).toBe("0");
  });
});

describe("the vector kind", () => {
  const point = vectorKind(2);

  it("has a name that holds its length", () => {
    expect(point.name).toBe("vector2");
  });

  it("parses an array of finite numbers of the right length, and copies it", () => {
    const input = [1, 2];
    const parsed = point.parse(input);
    expect(parsed).toEqual([1, 2]);
    expect(parsed).not.toBe(input);
  });

  it("rejects a wrong length, a non-array, and a bad component with a TypeError", () => {
    expect(() => point.parse([1])).toThrow("A vector2 value must be an array of 2 finite numbers.");
    for (const bad of [[1, 2, 3], "ab", null, undefined, 5, [1, NaN], [Infinity, 0], [1, "2"]]) expect(() => point.parse(bad), String(bad)).toThrow(TypeError);
  });

  it("rejects a length that is not a whole number above 0", () => {
    for (const bad of [0, -1, 1.5, NaN, Infinity]) expect(() => vectorKind(bad), String(bad)).toThrow(TypeError);
    expect(() => vectorKind(0)).toThrow("A vector kind needs a whole length of 1 or more.");
  });

  it("splits and joins by copy", () => {
    const value = [3, 4];
    expect(point.toArray(value)).toEqual([3, 4]);
    expect(point.toArray(value)).not.toBe(value);
    expect(point.fromArray([5, 6])).toEqual([5, 6]);
  });

  it("interpolates by component, measures the straight distance, and serializes with spaces", () => {
    expect(point.interpolate([0, 10], [10, 20], 0.5)).toEqual([5, 15]);
    expect(point.distance([0, 0], [3, 4])).toBe(5);
    expect(point.serialize([1, 0.123456])).toBe("1 0.1235");
  });
});
