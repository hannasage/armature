// The variables and the attributes of a flavor as a stylesheet. Each variable a controller writes gets an `@property` rule, so it has a type and a
// start value, and the surface gets one rule that puts it at rest on the surface attribute. The rule has no specificity (`:where`), so the inline
// values a controller writes always win. Every name is escaped, and every number is cut and written with no exponent.
import { cssVar, dataAttr, validateFlavor, type Flavor } from "../engine/flavor";
import { escapeIdent } from "./escape";
import { num } from "./text";

const suffix = (value: unknown, what: string): string => {
  if (typeof value !== "string") throw new TypeError(`${what} must be text.`);
  return value;
};

/**
 * The stylesheet of a flavor, as text. It runs with no DOM and no environment, so a build step or a server can write it.
 * - Every variable of the surface and the lens is registered with `@property`, with `inherits: false` and the value of a surface at rest.
 * - Every follower is registered as a number that inherits, with a start value of 0, because a stylesheet usually reads it in children.
 * - The surface attribute gets a `:where` rule that sets the five surface variables at rest, for a browser with no `@property`.
 * A flavor with none of these parts gives an empty string. A flavor that does not hold together throws a TypeError.
 */
export function cssFlavor(flavor: Flavor): string {
  validateFlavor(flavor);
  const who = `The flavor "${flavor.name}"`;
  const property = (part: unknown, syntax: string, initial: string, inherits = false) =>
    `@property ${escapeIdent(cssVar(flavor, suffix(part, `${who} has a variable name that`)))} { syntax: "${syntax}"; inherits: ${inherits}; initial-value: ${initial}; }`;
  const rules: string[] = [];
  let rest: string | undefined;

  const surface = flavor.surface;
  if (surface) {
    const at = surface.defaults?.specularRest;
    const x = `${num(at?.x, `${who} has a surface specular rest x that`)}%`;
    const y = `${num(at?.y, `${who} has a surface specular rest y that`)}%`;
    const { press, flex, specX, specY, glow } = surface.vars;
    const vars: Array<[string, string, string]> = [[press, "<number>", "1"], [flex, "<number>", "0"], [specX, "<percentage>", x], [specY, "<percentage>", y], [glow, "<number>", "0"]];
    rules.push(...vars.map(([name, syntax, initial]) => property(name, syntax, initial)));
    const selector = escapeIdent(dataAttr(flavor, suffix(surface.attributes.surface, `${who} has a surface attribute that`)));
    rest = [`:where([${selector}]) {`, ...vars.map(([name, , initial]) => `  ${escapeIdent(cssVar(flavor, name))}: ${initial};`), "}"].join("\n");
  }

  const lens = flavor.lens;
  if (lens) {
    const { x, y, w, h, sx, sy } = lens.vars;
    for (const name of [x, y, w, h]) rules.push(property(name, "<length>", "0px"));
    for (const name of [sx, sy]) rules.push(property(name, "<number>", "1"));
  }

  for (const spec of Object.values(flavor.followers ?? {})) rules.push(property(spec.var, "<number>", "0", true));

  if (rest) rules.push(rest);
  return rules.length === 0 ? "" : `${rules.join("\n")}\n`;
}
