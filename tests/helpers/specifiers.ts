/** Every module specifier in a source text: static imports, type imports, re-exports, side-effect imports, dynamic imports, and require calls. */
export function specifiersOf(text: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\b(?:import|export)\b[^"'`;]*?\bfrom\s*["']([^"']+)["']/g, // import x from, import type x from, export * from, export { x } from
    /\bimport\s*["']([^"']+)["']/g, // import "x"
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // import("x")
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, // require("x")
  ];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) found.push(match[1]);
  return found;
}

/**
 * The dynamic imports whose argument is not a single string literal, such as `import(name)` or a template string.
 * `specifiersOf` can read only a literal, so a call like this hides where it points.
 */
export function nonLiteralDynamicImports(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/(?<![\w$.])import\s*\(/g)) {
    const rest = text.slice(match.index + match[0].length);
    if (!/^\s*(?:"[^"\n]*"|'[^'\n]*')\s*\)/.test(rest)) found.push(`import(${rest.slice(0, 30).split("\n")[0]}`);
  }
  return found;
}
