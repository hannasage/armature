import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./support";

interface Entry {
  name: string;
  script: string;
  subcommand: string | null;
  description: string;
  arguments: { name: string; type: string; required: boolean; description: string }[];
  output: string;
  safety: string;
  writes: string;
  writesPaths: string[];
}

const manifest = JSON.parse(readFileSync(join(repoRoot, "tools/manifest.json"), "utf8")) as { schema: number; tools: Entry[] };
// The behavior of each class is tested in safety.test.ts: it runs every subcommand and compares what changed with writesPaths.
const release = (await import(pathToFileURL(join(repoRoot, "scripts/release.mjs")).href)) as { SAFETY: Record<string, string> };
const CLASSES = ["read-only", "local-write", "remote-write", "human-only"];
const entry = (name: string) => manifest.tools.find((tool) => tool.name === name);

describe("tools/manifest.json", () => {
  it("has a schema number and a list of tools", () => {
    expect(manifest.schema).toBe(1);
    expect(manifest.tools.length).toBeGreaterThan(0);
  });

  it("gives every entry a name, a description, arguments, an output shape, and a safety class", () => {
    for (const tool of manifest.tools) {
      expect(typeof tool.name, tool.name).toBe("string");
      expect(tool.description.length, tool.name).toBeGreaterThan(10);
      expect(Array.isArray(tool.arguments), tool.name).toBe(true);
      for (const argument of tool.arguments) {
        expect(argument.name, tool.name).toMatch(/^(--[a-z-]+|<[a-z-]+>)$/);
        expect(["flag", "string", "path"], `${tool.name} ${argument.name}`).toContain(argument.type);
        expect(typeof argument.required).toBe("boolean");
        expect(argument.description.length).toBeGreaterThan(0);
      }
      expect(tool.output.length, tool.name).toBeGreaterThan(10);
      expect(CLASSES, tool.name).toContain(tool.safety);
      expect(tool.writes.length, tool.name).toBeGreaterThan(0);
      expect(Array.isArray(tool.writesPaths), tool.name).toBe(true);
      if (tool.safety === "read-only" || tool.safety === "human-only") expect(tool.writesPaths, tool.name).toEqual([]);
    }
  });

  it("has unique names", () => {
    const names = manifest.tools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("lists only script files that exist", () => {
    for (const tool of manifest.tools) expect(existsSync(join(repoRoot, tool.script)), tool.script).toBe(true);
  });

  it("lists every tools/*.mjs file", () => {
    const listed = new Set(manifest.tools.map((tool) => tool.script));
    for (const file of readdirSync(join(repoRoot, "tools")).filter((name) => name.endsWith(".mjs"))) expect(listed.has(`tools/${file}`), file).toBe(true);
  });

  it("lists every subcommand of the release script, once", () => {
    for (const subcommand of Object.keys(release.SAFETY)) {
      const tool = entry(`release ${subcommand}`);
      expect(tool, subcommand).toBeDefined();
      expect(tool?.script).toBe("scripts/release.mjs");
      expect(tool?.subcommand).toBe(subcommand);
    }
    expect(manifest.tools.filter((tool) => tool.script === "scripts/release.mjs")).toHaveLength(Object.keys(release.SAFETY).length);
  });

  it("does not understate the class of a script", () => {
    expect(entry("gates")?.safety).toBe("local-write");
    expect(entry("release gates")?.safety).toBe("local-write");
    expect(entry("release dry-run")?.safety).toBe("local-write");
    expect(entry("release preflight")?.safety).toBe("local-write");
    expect(entry("release verify")?.safety).toBe("local-write");
    expect(entry("pr-open")?.safety).toBe("remote-write");
    expect(entry("release tag")?.safety).toBe("remote-write");
    expect(entry("release publish")?.safety).toBe("human-only");
    expect(entry("release retire")?.safety).toBe("human-only");
    expect(entry("tree-clean")?.safety).toBe("read-only");
  });
});
