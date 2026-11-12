import { describe, expect, it } from "vitest";
import { pathKind } from "../../src/values";

// The path kind. A path value is SVG path data. The kind is made for one structure: the commands, in order, of a template path. A path with
// another structure is rejected. There is no resampler, so two paths that differ in structure cannot be blended.

const triangle = "M 0 0 L 10 0 L 5 10 Z";

describe("the path kind: parse", () => {
  it("has a name that holds the structure, with the flags of an arc", () => {
    expect(pathKind(triangle).name).toBe("path:MLLZ");
  });

  it("writes a path in one plain form: a letter, then its numbers, with a space between", () => {
    const kind = pathKind("M0 0L10 0L5 10z");
    expect(kind.parse("M0 0L10 0L5 10z")).toBe(triangle);
    expect(kind.parse("  M 0,0 L 10,0 L 5,10 Z ")).toBe(triangle);
    expect(kind.parse("M0,0L10,0 5,10Z")).toBe(triangle);
  });

  it("reads every command: M L H V C S Q T A Z, absolute and relative", () => {
    const text = "M1 2 L3 4 H5 V6 C1 2 3 4 5 6 S1 2 3 4 Q1 2 3 4 T5 6 A1 2 30 1 0 5 6 Z m1 2 l3 4 h5 v6 c1 2 3 4 5 6 s1 2 3 4 q1 2 3 4 t5 6 a1 2 30 0 1 5 6 z";
    const kind = pathKind(text);
    expect(kind.name).toBe("path:MLHVCSQTA10Zmlhvcsqta01Z");
    expect(kind.parse(text)).toBe(kind.serialize(kind.parse(text)));
    expect(kind.parse(text)).toContain("A 1 2 30 1 0 5 6");
    expect(kind.parse(text)).toContain("a 1 2 30 0 1 5 6");
  });

  it("reads compact numbers: signs, leading dots, and exponents", () => {
    expect(pathKind("M0-1.5.5-2").parse("M0-1.5.5-2")).toBe("M 0 -1.5 L 0.5 -2");
    expect(pathKind("M1e1 2E-1").parse("M1e1 2E-1")).toBe("M 10 0.2");
    expect(pathKind("M+1 +2").parse("M+1 +2")).toBe("M 1 2");
  });

  it("reads the arc flags without a separator", () => {
    expect(pathKind("M0 0a1 1 0 00 1 1").parse("M0 0a1 1 0 00 1 1")).toBe("M 0 0 a 1 1 0 0 0 1 1");
    expect(pathKind("M0 0a1 1 0 00 1 1").parse("M0 0a1 1 0 0 0 1 1")).toBe("M 0 0 a 1 1 0 0 0 1 1");
    expect(pathKind("M0 0a1 1 0 11 1 1").parse("M0 0a1 1 0 11 1 1")).toBe("M 0 0 a 1 1 0 1 1 1 1");
    expect(pathKind("M0 0a1 1 0 01-1-1").parse("M0 0a1 1 0 01-1-1")).toBe("M 0 0 a 1 1 0 0 1 -1 -1");
  });

  it("repeats a command when its numbers repeat, and a moveto turns into a lineto", () => {
    expect(pathKind("M0 0 10 0 5 10").parse("M0 0 10 0 5 10")).toBe("M 0 0 L 10 0 L 5 10");
    expect(pathKind("m0 0 10 0").parse("m0 0 10 0")).toBe("m 0 0 l 10 0");
    expect(pathKind("M0 0 C1 1 2 2 3 3 4 4 5 5 6 6").parse("M0 0 C1 1 2 2 3 3 4 4 5 5 6 6")).toBe("M 0 0 C 1 1 2 2 3 3 C 4 4 5 5 6 6");
    expect(pathKind("M0 0H1 2 3").name).toBe("path:MHHH");
  });

  it("treats z and Z as the same command, and keeps several subpaths", () => {
    const kind = pathKind("M0 0L1 1z M5 5L6 6Z");
    expect(kind.name).toBe("path:MLZMLZ");
    expect(kind.parse("M0 0L1 1Z M5 5L6 6z")).toBe("M 0 0 L 1 1 Z M 5 5 L 6 6 Z");
  });

  it("copes with a long path of many commands", () => {
    const text = `M0 0${" L1 2".repeat(5000)}Z`;
    const kind = pathKind(text);
    expect(kind.toArray(kind.parse(text))).toHaveLength(10002);
  });

  it("rejects text that is not path data, with a TypeError that says why", () => {
    const bad = ["", "   ", "L 0 0", "M", "M 0", "M 0 0 L 1", "M 0 0 X 1 2", "M 0 0 L 1 2 3", "M 0 0 Z 1", "M 0 0 L a b", "M 0 0 L 1e999 5", "M 0 0 A 1 1 0 2 0 1 1", "M 0 0 A 1 1 0 0", "M 0 0 L 1 1 #"];
    for (const text of bad) {
      expect(() => pathKind("M0 0L1 1").parse(text), JSON.stringify(text)).toThrow(TypeError);
      expect(() => pathKind(text), JSON.stringify(text)).toThrow(TypeError);
    }
    for (const input of [5, null, undefined, {}, ["M", 0, 0]]) expect(() => pathKind("M0 0").parse(input), String(input)).toThrow(/path/i);
    expect(() => pathKind("L 0 0")).toThrow(/start with a moveto/);
  });
});

describe("the path kind: unequal structure", () => {
  const kind = pathKind(triangle);

  it("rejects a path with another count of commands, and names both structures", () => {
    expect(() => kind.parse("M 0 0 L 10 0 Z")).toThrow(TypeError);
    expect(() => kind.parse("M 0 0 L 10 0 Z")).toThrow('The path has a different structure than the template. Expected "M L L Z" and got "M L Z".');
  });

  it("rejects another command in the same place, and a relative command for an absolute one", () => {
    expect(() => kind.parse("M 0 0 L 10 0 H 5 Z")).toThrow(/different structure/);
    expect(() => kind.parse("M 0 0 l 10 0 L 5 10 Z")).toThrow(/different structure/);
    expect(() => kind.parse("M 0 0 L 10 0 L 5 10")).toThrow(/different structure/);
  });

  it("rejects arc flags that differ, because a flag cannot be blended", () => {
    const arc = pathKind("M0 0 A 5 5 0 0 1 10 10");
    expect(() => arc.parse("M0 0 A 5 5 0 1 1 10 10")).toThrow(/different structure/);
    expect(() => arc.parse("M0 0 A 5 5 0 0 0 10 10")).toThrow(/different structure/);
    expect(arc.parse("M0 0 A 9 9 45 0 1 20 20")).toBe("M 0 0 A 9 9 45 0 1 20 20");
  });

  it("rejects it from interpolate and distance too, and not only from parse", () => {
    expect(() => kind.interpolate(triangle, "M 0 0 L 10 0 Z", 0.5)).toThrow(/different structure/);
    expect(() => kind.interpolate("M 0 0 L 10 0 Z", triangle, 0.5)).toThrow(/different structure/);
    expect(() => kind.distance(triangle, "M 0 0 L 10 0 Z")).toThrow(/different structure/);
  });

  it("accepts any two paths of the same structure with different numbers", () => {
    expect(kind.parse("M 5 5 L 1 1 L 2 3 Z")).toBe("M 5 5 L 1 1 L 2 3 Z");
  });
});

describe("the path kind: round trips, interpolate, and distance", () => {
  const kind = pathKind("M0 0 C 1 1 2 2 3 3 A 1 1 0 0 1 4 4 L 5 5 Z");
  const a = kind.parse("M 0 0 C 10 20 30 40 50 60 A 5 5 0 0 1 70 80 L 90 100 Z");
  const b = kind.parse("M 10 10 C 20 30 50 70 90 110 A 15 25 90 0 1 130 150 L 170 190 Z");

  it("splits into the numbers, with no arc flags, and joins back to the same text", () => {
    expect(kind.toArray(a)).toEqual([0, 0, 10, 20, 30, 40, 50, 60, 5, 5, 0, 70, 80, 90, 100]);
    expect(kind.fromArray(kind.toArray(a))).toBe(a);
    expect(kind.serialize(a)).toBe(a);
    expect(kind.parse(kind.serialize(a))).toBe(a);
  });

  it("writes at most 6 decimals", () => {
    expect(kind.fromArray([1 / 3, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0])).toContain("M 0.333333 0");
    expect(kind.serialize(a.replace("M 0 0", "M 0.1234567891 0"))).toContain("M 0.123457 0");
  });

  it("keeps full precision in parse and toArray, and rounds only in serialize", () => {
    const small = pathKind("M0 0 C 0 0 0 0 0 0");
    const text = "M 0.123456789 0.987654321 C 0.111111111 0.222222222 0.333333333 0.444444444 0.555555555 0.666666666";
    const parsed = small.parse(text);
    expect(parsed).toBe(text);
    expect(small.toArray(parsed)[0]).toBe(0.123456789);
    expect(small.serialize(parsed)).toBe("M 0.123457 0.987654 C 0.111111 0.222222 0.333333 0.444444 0.555556 0.666667");
  });

  it("round trips a path on a 0 to 1 viewBox to within 1e-5, through a spring-sized tween", () => {
    const unit = pathKind("M0 0 C 0 0 0 0 0 0 L 0 0 Z");
    const x = "M 0.0123456 0.9876543 C 0.1111119 0.2222228 0.3333337 0.4444446 0.5555555 0.6666664 L 0.7777773 0.8888882 Z";
    const y = "M 0.9123456 0.1876543 C 0.5111119 0.7222228 0.1333337 0.9444446 0.0555555 0.0666664 L 0.2777773 0.3888882 Z";
    const numbers = (d: string) => d.match(/[\d.]+/g)!.map(Number);
    numbers(unit.fromArray(unit.toArray(x))).forEach((n, i) => expect(Math.abs(n - numbers(x)[i])).toBeLessThan(1e-5));
    numbers(unit.serialize(x)).forEach((n, i) => expect(Math.abs(n - numbers(x)[i])).toBeLessThan(1e-5));
    numbers(unit.interpolate(x, y, 0.37)).forEach((n, i) => expect(Math.abs(n - (numbers(x)[i] + (numbers(y)[i] - numbers(x)[i]) * 0.37))).toBeLessThan(1e-5));
  });

  it("throws a named TypeError from fromArray for a wrong length or a part that is not finite", () => {
    const all = kind.toArray(a);
    expect(() => kind.fromArray(all.slice(1))).toThrow(TypeError);
    expect(() => kind.fromArray([...all, 1])).toThrow(/path/);
    expect(() => kind.fromArray(all.map((n, i) => (i === 3 ? NaN : n)))).toThrow(/path.*finite/);
    expect(() => kind.fromArray(all.map((n, i) => (i === 3 ? Infinity : n)))).toThrow(TypeError);
    expect(() => kind.interpolate(a, b, NaN)).toThrow(TypeError);
  });

  it("lands exactly on both ends, and blends in a straight line between them", () => {
    expect(kind.interpolate(a, b, 0)).toBe(a);
    expect(kind.interpolate(a, b, 1)).toBe(b);
    expect(kind.interpolate(a, b, 0.5)).toBe("M 5 5 C 15 25 40 55 70 85 A 10 15 45 0 1 100 115 L 130 145 Z");
  });

  it("measures distance between the numbers: zero for the same path, symmetric", () => {
    expect(kind.distance(a, a)).toBe(0);
    expect(kind.distance(a, b)).toBe(kind.distance(b, a));
    expect(kind.distance(a, b)).toBeGreaterThan(100);
    expect(pathKind("M0 0 L 3 4").distance("M 0 0 L 3 4", "M 0 0 L 0 0")).toBe(5);
  });
});
