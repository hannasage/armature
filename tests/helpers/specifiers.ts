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
