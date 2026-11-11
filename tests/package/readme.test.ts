import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The README check. It runs the rules on the real README and on small broken copies, so each rule has a fail case.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

type Pkg = {
  name: string;
  version: string;
  private?: boolean;
  publishConfig?: { tag?: string };
  exports: Record<string, unknown>;
};

const rules = (await import(pathToFileURL(join(root, "scripts/readme-rules.mjs")).href)) as {
  checkReadme: (readme: string, pkg: Pkg) => string[];
};

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Pkg;
const readme = readFileSync(join(root, "README.md"), "utf8");

const small: Pkg = {
  name: "@scope/thing",
  version: "1.0.0-beta.0",
  publishConfig: { tag: "beta" },
  exports: { ".": {}, "./dom": {}, "./styles.css": "./x.css" },
};
const smallReadme = [
  "# Thing",
  "Status: pre-release. It is published on the npm `beta` tag as 1.0.0-beta.0.",
  "```bash",
  "npm install @scope/thing@beta",
  "```",
  "## The two subpaths",
  "- `@scope/thing` is the engine.",
  "- `@scope/thing/dom` is the DOM layer.",
  "- `@scope/thing/styles.css` is the stylesheet.",
].join("\n");

describe("README check", () => {
  it("passes on the real README and package.json", () => {
    expect(rules.checkReadme(readme, pkg)).toEqual([]);
  });

  it("passes on a small matching pair", () => {
    expect(rules.checkReadme(smallReadme, small)).toEqual([]);
  });

  it("fails when the status line names another version", () => {
    const problems = rules.checkReadme(smallReadme.replace("1.0.0-beta.0", "0.0.0"), small);
    expect(problems.join("\n")).toContain("does not name the version 1.0.0-beta.0");
    expect(problems.join("\n")).toContain("names the version 0.0.0");
  });

  it("fails when the status says the package is private and package.json is public", () => {
    const text = smallReadme.replace(/^Status:.*$/m, "Status: pre-release. Nothing is published. The package is private.");
    expect(rules.checkReadme(text, small).join("\n")).toContain("says the package is private or unpublished");
  });

  it("fails when package.json is private and the status does not say so", () => {
    expect(rules.checkReadme(smallReadme, { ...small, private: true }).join("\n")).toContain('has "private": true');
  });

  it("fails when the install command lacks the tag", () => {
    const problems = rules.checkReadme(smallReadme.replace("thing@beta", "thing"), small);
    expect(problems.join("\n")).toContain("needs @beta");
  });

  it("fails when the install command names another package", () => {
    const problems = rules.checkReadme(smallReadme.replace("npm install @scope/thing@beta", "npm install @scope/other@beta"), small);
    expect(problems.join("\n")).toContain("names @scope/other");
  });

  it("fails when the README has no install command", () => {
    expect(rules.checkReadme(smallReadme.replace("npm install @scope/thing@beta", ""), small).join("\n")).toContain("no npm install command");
  });

  it("fails when an export is missing from the README", () => {
    const text = smallReadme.replace("- `@scope/thing/dom` is the DOM layer.\n", "");
    expect(rules.checkReadme(text, small).join("\n")).toContain("does not list the export ./dom");
  });

  it("fails when the README names a subpath that is not exported", () => {
    const text = `${smallReadme}\n- \`@scope/thing/vue\` is an adapter.`;
    expect(rules.checkReadme(text, small).join("\n")).toContain("names @scope/thing/vue");
  });

  it("fails when the heading count is wrong", () => {
    expect(rules.checkReadme(smallReadme.replace("two subpaths", "five subpaths"), small).join("\n")).toContain('says "five" subpaths');
  });

  it("fails when the status line is missing", () => {
    expect(rules.checkReadme(smallReadme.replace(/^Status:.*$/m, ""), small).join("\n")).toContain('exactly one line that starts with "Status:"');
  });
});
