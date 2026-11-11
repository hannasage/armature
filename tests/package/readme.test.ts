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

  it("fails when a deleted bullet is still named in prose", () => {
    const text = smallReadme.replace("- `@scope/thing/dom` is the DOM layer.\n", "").replace("# Thing", "# Thing\nUse `@scope/thing/dom` for the DOM.");
    expect(rules.checkReadme(text, small).join("\n")).toContain("does not list the export ./dom");
  });

  it("does not count a name inside a fenced block or a URL as a listing", () => {
    const text = smallReadme.replace("- `@scope/thing/dom` is the DOM layer.\n", "") + "\n```ts\nimport x from \"@scope/thing/dom\";\n```\nSee https://example.com/@scope/thing/dom";
    expect(rules.checkReadme(text, small).join("\n")).toContain("does not list the export ./dom");
  });

  it("does not fail on a URL that holds the package path", () => {
    const text = `${smallReadme}\nSee https://example.com/@scope/thing/extra for notes.`;
    expect(rules.checkReadme(text, small)).toEqual([]);
  });

  it("fails when the subpaths heading is missing", () => {
    const problems = rules.checkReadme(smallReadme.replace("## The two subpaths", "## Subpaths"), small);
    expect(problems.join("\n")).toContain('needs a heading "## The <number> subpaths"');
  });

  it("fails when package.json has no exports, or an empty exports map", () => {
    expect(rules.checkReadme(smallReadme, { ...small, exports: {} }).join("\n")).toContain("has no exports");
    expect(rules.checkReadme(smallReadme, { ...small, exports: undefined as never }).join("\n")).toContain("has no exports");
  });

  it("matches the version on token boundaries", () => {
    const problems = rules.checkReadme(smallReadme.replace("1.0.0-beta.0.", "1.0.0-beta.01."), small);
    expect(problems.join("\n")).toContain("does not name the version 1.0.0-beta.0");
  });

  it("accepts the version at the end of a sentence", () => {
    expect(rules.checkReadme(smallReadme, small)).toEqual([]);
  });

  it("escapes a tag that holds regular expression characters", () => {
    const odd: Pkg = { ...small, publishConfig: { tag: "b.ta" } };
    const text = smallReadme.replace("`beta`", "`bXta`").replace("thing@beta", "thing@b.ta");
    expect(rules.checkReadme(text, odd).join("\n")).toContain("does not name the `b.ta` tag");
  });

  describe("for a stable version", () => {
    const stable: Pkg = { name: "@scope/thing", version: "1.2.0", exports: small.exports };
    const stableReadme = smallReadme.replace(/^Status:.*$/m, "Status: stable. It is published as 1.2.0.").replace("thing@beta", "thing");

    it("passes on a matching pair", () => {
      expect(rules.checkReadme(stableReadme, stable)).toEqual([]);
      expect(rules.checkReadme(stableReadme.replace("thing\n", "thing@latest\n"), stable)).toEqual([]);
    });

    it("fails an install command with another dist-tag", () => {
      expect(rules.checkReadme(stableReadme.replace("thing\n", "thing@beta\n"), stable).join("\n")).toContain("install command is @scope/thing@beta");
    });

    it("fails a status line that names any dist-tag other than latest", () => {
      for (const tag of ["beta", "canary", "experimental"]) {
        const text = stableReadme.replace("published as", `published on the \`${tag}\` tag as`);
        expect(rules.checkReadme(text, stable).join("\n")).toContain(`names the \`${tag}\` tag`);
      }
      expect(rules.checkReadme(stableReadme.replace("published as", "published on the `latest` tag as"), stable)).toEqual([]);
    });

    it("fails a status line that names the beta tag", () => {
      const text = stableReadme.replace("published as", "published on the `beta` tag as");
      expect(rules.checkReadme(text, stable).join("\n")).toContain("names the `beta` tag");
    });
  });

  describe("for a prerelease version published on latest", () => {
    const odd: Pkg = { ...small, publishConfig: { tag: "latest" } };
    const oddReadme = smallReadme.replace("npm install @scope/thing@beta", "npm install @scope/thing").replace("on the npm `beta` tag", "on the npm `latest` tag");

    it("passes when the status names the version and the install has no tag", () => {
      expect(rules.checkReadme(oddReadme, odd)).toEqual([]);
    });

    it("does not tell the reader to install the @latest tag as if it were a prerelease tag", () => {
      const problems = rules.checkReadme(oddReadme.replace("thing\n", "thing@beta\n"), odd).join("\n");
      expect(problems).toContain("install command is @scope/thing@beta");
      expect(problems).toContain("needs no tag");
    });
  });

  describe("fenced code", () => {
    it("strips a fence that is indented up to three spaces", () => {
      const text = smallReadme.replace("- `@scope/thing/dom` is the DOM layer.\n", "  ```ts\n  - `@scope/thing/dom` is the DOM layer.\n  ```\n");
      expect(rules.checkReadme(text, small).join("\n")).toContain("does not list the export ./dom");
    });

    it("does not end the subpaths section at a ## line inside a fence", () => {
      const text = smallReadme.replace("- `@scope/thing` is the engine.\n", "- `@scope/thing` is the engine.\n```md\n## Example\n```\n");
      expect(rules.checkReadme(text, small)).toEqual([]);
    });

    it("does not take a subpaths heading from inside a fence", () => {
      const text = smallReadme.replace("## The two subpaths", "```md\n## The two subpaths\n```\n## Other");
      expect(rules.checkReadme(text, small).join("\n")).toContain('needs a heading "## The <number> subpaths"');
    });
  });
});
