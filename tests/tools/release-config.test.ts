import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./support";

const read = (name: string) => JSON.parse(readFileSync(join(repoRoot, name), "utf8"));
const config = read("release.config.json");
const pkg = read("package.json");

describe("release.config.json", () => {
  it("agrees with package.json on the name, the version, and the publish tag", () => {
    expect(config.package).toBe(pkg.name);
    expect(config.version).toBe(pkg.version);
    expect(config.npmTag).toBe(pkg.publishConfig.tag);
    expect(config.access).toBe(pkg.publishConfig.access);
  });

  it("names the release branch and a positive file count", () => {
    expect(config.releaseBranch).toBe("release/1.0.0");
    expect(Number.isInteger(config.expectedFileCount)).toBe(true);
    expect(config.expectedFileCount).toBeGreaterThan(0);
  });

  it("does not copy the number of public names, it points at the list", () => {
    expect(config.publicApi.file).toBe("scripts/public-api.mjs");
    expect(JSON.stringify(config)).not.toMatch(/"(expectedApiCount|apiCount|publicApiCount)"/);
  });

  it("holds the git tag name pattern", () => {
    expect(config.gitTag.name).toContain("{version}");
  });

  it("holds the retire commands and the claim patterns", () => {
    expect(config.retire.commands).toHaveLength(3);
    expect(config.retire.commands.map((command: string[]) => command.slice(0, 2).join(" "))).toEqual(["npm deprecate", "npm dist-tag", "npm dist-tag"]);
    expect(config.claims.patterns.length).toBeGreaterThan(0);
    expect(config.claims.paths).toContain("README.md");
  });

  it("expands to the commands in docs/releasing.md", async () => {
    const release = (await import(pathToFileURL(join(repoRoot, "scripts/release.mjs")).href)) as {
      retireCommands(config: unknown): string[][];
      gitTagName(config: unknown): string;
    };
    expect(release.retireCommands(config).map((command) => command.join(" "))).toEqual([
      'npm deprecate @hannasage/armature@1.0.0-next.0 Renamed to the beta tag. Use 1.0.0-beta.0.',
      "npm dist-tag rm @hannasage/armature next",
      "npm dist-tag add @hannasage/armature@1.0.0-beta.1 latest",
    ]);
    expect(release.gitTagName(config)).toBe("v1.0.0-beta.1");
  });
});
