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
  safety_class: string;
  writes: string;
  writesPaths: string[];
  destructive?: unknown;
  mcp_exposure?: unknown;
}

const manifest = JSON.parse(readFileSync(join(repoRoot, "tools/manifest.json"), "utf8")) as { schema: number; tools: Entry[] };
// The behavior of each class is tested in safety.test.ts: it runs every subcommand and compares what changed with writesPaths.
const release = (await import(pathToFileURL(join(repoRoot, "scripts/release.mjs")).href)) as { SAFETY: Record<string, string> };
const CLASSES = ["read-only", "local-write", "remote-write", "human-only"];
// ---- The shared exposure check, ported from the factory manifest test (its COPY-START to COPY-END block). ----
const EXPOSURE_VALUES = ["expose", "hidden"];
const SAFETY_CLASS_NAMES = ["read-only", "local-write", "remote-write", "human-only"];
const MAX_TOOLS = 1000;

/** Problems with the exposure field. An empty list means the manifest is sound. It never throws on a malformed manifest. */
function exposureProblems(manifest: any): string[] {
  const isObject = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!isObject(manifest) || !Array.isArray(manifest.tools) || manifest.tools.length === 0) return ["the manifest needs a non-empty tools list"];
  if (manifest.tools.length > MAX_TOOLS) return [`the manifest has more than ${MAX_TOOLS} tools`];
  const problems: string[] = [];
  if ("exposure_default" in manifest && manifest.exposure_default !== "hidden") problems.push("exposure_default must be hidden");
  const names: string[] = [];
  manifest.tools.forEach((tool: unknown, index: number) => {
    const name = isObject(tool) ? tool.name : undefined;
    if (typeof name !== "string" || name.trim() === "") problems.push(`tool #${index}: needs a name`);
    else names.push(name);
  });
  for (const name of [...new Set(names.filter((n) => names.filter((m) => m === n).length > 1))].sort()) problems.push(`${name}: the name appears more than once`);
  const held = manifest.held_back ?? [];
  const heldNames: string[] = [];
  if (!Array.isArray(held)) problems.push("held_back must be a list");
  else {
    for (const entry of held) {
      if (isObject(entry) && typeof entry.tool === "string") {
        heldNames.push(entry.tool);
        if (!names.includes(entry.tool)) problems.push(`held_back names ${entry.tool}, which is not a tool`);
      } else problems.push("held_back entries need a tool name");
    }
  }
  for (const tool of manifest.tools) {
    const name = isObject(tool) ? tool.name : undefined;
    if (typeof name !== "string" || name.trim() === "") continue;
    const exposed = tool.mcp_exposure === "expose";
    if ("mcp_exposure" in tool && !(typeof tool.mcp_exposure === "string" && EXPOSURE_VALUES.includes(tool.mcp_exposure))) problems.push(`${name}: mcp_exposure must be expose or hidden`);
    const safety = tool.safety_class;
    if (!SAFETY_CLASS_NAMES.includes(safety)) problems.push(`${name}: safety_class must be one of ${SAFETY_CLASS_NAMES.join(", ")}`);
    if (safety === "human-only" && exposed) problems.push(`${name}: a human-only tool must be hidden`);
    if ("destructive" in tool && typeof tool.destructive !== "boolean") problems.push(`${name}: destructive must be true or false`);
    else if (tool.destructive === true && exposed) problems.push(`${name}: a destructive tool must be hidden`);
    else if (exposed && tool.destructive !== false) problems.push(`${name}: an exposed tool must say destructive: false`);
    if (heldNames.includes(name) && exposed) problems.push(`${name}: a held-back tool must be hidden`);
  }
  return problems;
}

/** The one loader. It lists a tool only when the whole manifest passes exposureProblems and the tool says exactly "expose". */
function exposedTools(manifest: any): any[] {
  if (exposureProblems(manifest).length > 0) return [];
  return manifest.tools.filter((tool: any) => tool.mcp_exposure === "expose");
}

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
      expect(CLASSES, tool.name).toContain(tool.safety_class);
      expect(tool.writes.length, tool.name).toBeGreaterThan(0);
      expect(Array.isArray(tool.writesPaths), tool.name).toBe(true);
      if (tool.safety_class === "read-only" || tool.safety_class === "human-only") expect(tool.writesPaths, tool.name).toEqual([]);
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
    expect(entry("gates")?.safety_class).toBe("local-write");
    expect(entry("release gates")?.safety_class).toBe("local-write");
    expect(entry("release dry-run")?.safety_class).toBe("local-write");
    expect(entry("release preflight")?.safety_class).toBe("local-write");
    expect(entry("release verify")?.safety_class).toBe("local-write");
    expect(entry("pr-open")?.safety_class).toBe("remote-write");
    expect(entry("release tag")?.safety_class).toBe("remote-write");
    expect(entry("release publish")?.safety_class).toBe("human-only");
    expect(entry("release retire")?.safety_class).toBe("human-only");
    expect(entry("tree-clean")?.safety_class).toBe("read-only");
  });
});

describe("MCP exposure", () => {
  const make = (...tools: [string, string, string | undefined][]) => ({
    tools: tools.map(([name, safety_class, mcp_exposure]) => ({ name, safety_class, destructive: false, ...(mcp_exposure === undefined ? {} : { mcp_exposure }) })),
  });

  it("the real manifest passes the shared check", () => {
    expect(exposureProblems(manifest)).toEqual([]);
    expect((manifest as { exposure_default?: string }).exposure_default).toBe("hidden");
    expect(Object.keys((manifest as { mcp_exposure?: object }).mcp_exposure ?? {}).sort()).toEqual(["expose", "hidden"]);
  });

  it("gives every tool a destructive flag and an exposure value", () => {
    for (const tool of manifest.tools) {
      expect(typeof tool.destructive, tool.name).toBe("boolean");
      expect(["expose", "hidden"], tool.name).toContain(tool.mcp_exposure);
    }
  });

  it("exposes only the read-only tools whose run changes nothing", () => {
    expect(exposedTools(manifest).map((tool) => tool.name).sort()).toEqual(["release claims", "release status", "tree-clean"]);
    for (const tool of exposedTools(manifest)) {
      expect(tool.safety_class).toBe("read-only");
      expect(tool.writesPaths).toEqual([]);
      expect(tool.destructive).toBe(false);
    }
  });

  it("hides every human-only, remote-write, local-write, and destructive tool", () => {
    for (const tool of manifest.tools) {
      if (tool.safety_class !== "read-only" || tool.destructive === true) expect(tool.mcp_exposure, tool.name).toBe("hidden");
    }
    expect(entry("release publish")?.mcp_exposure).toBe("hidden");
    expect(entry("release retire")?.mcp_exposure).toBe("hidden");
  });

  it("fails a manifest that exposes a human-only tool, and then exposes nothing", () => {
    const broken = make(["a", "read-only", "expose"], ["b", "human-only", "expose"]);
    expect(exposureProblems(broken).join()).toContain("b: a human-only tool must be hidden");
    expect(exposedTools(broken)).toEqual([]);
  });

  it("fails an exposed tool that is destructive or does not say destructive false", () => {
    const destructive = make(["a", "read-only", "expose"]);
    (destructive.tools[0] as { destructive: unknown }).destructive = true;
    expect(exposureProblems(destructive).join()).toContain("a destructive tool must be hidden");
    const silent = make(["a", "read-only", "expose"]);
    delete (silent.tools[0] as { destructive?: unknown }).destructive;
    expect(exposureProblems(silent).join()).toContain("must say destructive: false");
    expect(exposedTools(destructive)).toEqual([]);
    expect(exposedTools(silent)).toEqual([]);
  });

  it("treats a missing field as hidden", () => {
    const manifestWithGap = make(["a", "read-only", "expose"], ["b", "read-only", undefined]);
    expect(exposureProblems(manifestWithGap)).toEqual([]);
    expect(exposedTools(manifestWithGap).map((tool) => tool.name)).toEqual(["a"]);
  });

  it("exposes nothing when any rule breaks", () => {
    const good = make(["a", "read-only", "expose"]);
    expect(exposedTools(good)).toHaveLength(1);
    for (const broken of [
      { ...good, exposure_default: "expose" },
      { tools: [...good.tools, ...good.tools] },
      { tools: [{ ...good.tools[0], mcp_exposure: "maybe" }] },
      { tools: [{ ...good.tools[0], safety_class: "root" }] },
      { ...good, held_back: [{ tool: "a" }] },
      { ...good, held_back: [{ tool: "missing" }] },
      { tools: [] },
      null,
      "text",
      { tools: [null] },
    ]) {
      expect(exposedTools(broken), JSON.stringify(broken)).toEqual([]);
    }
  });
});
