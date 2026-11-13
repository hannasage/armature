import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { changedPaths, cleanup, makeReleaseRepo, repoRoot, snapshot, type ReleaseRepo } from "./support";

afterEach(cleanup);

interface Entry {
  name: string;
  script: string;
  subcommand: string | null;
  safety_class: string;
  writesPaths: string[];
}

const manifest = JSON.parse(readFileSync(join(repoRoot, "tools/manifest.json"), "utf8")) as { tools: Entry[] };
const BETA = JSON.stringify({ beta: "1.0.0-beta.1", next: "1.0.0-next.0", latest: "1.0.0-next.0" });

/** Brings the repository to the state in which the subcommand can do its work. */
function prepare(repo: ReleaseRepo, subcommand: string) {
  writeBeta(repo);
  if (subcommand === "tag") {
    expect(repo.run(["preflight"]).status).toBe(0);
    expect(repo.run(["verify"]).status).toBe(0);
  }
}
function writeBeta(repo: ReleaseRepo) {
  writeFileSync(join(repo.fake.fixtures, "dist-tags.json"), BETA);
}

const entries = manifest.tools.filter((tool) => tool.script === "scripts/release.mjs");

describe("what each release subcommand changes", () => {
  for (const entry of entries) {
    it(`${entry.name} (${entry.safety_class}) changes only the paths it declares`, () => {
      const repo = makeReleaseRepo();
      prepare(repo, entry.subcommand ?? "");
      const before = snapshot(repo.work);
      const result = repo.run([entry.subcommand ?? ""]);
      expect([0, 1, 2], result.stdout).toContain(result.status);
      const changed = changedPaths(before, snapshot(repo.work));
      if (entry.safety_class === "read-only" || entry.safety_class === "human-only") {
        expect(entry.writesPaths, entry.name).toEqual([]);
        expect(changed, entry.name).toEqual([]);
      } else {
        expect(entry.writesPaths.length, entry.name).toBeGreaterThan(0);
        for (const path of changed) expect(entry.writesPaths.some((prefix) => path === prefix || path.startsWith(prefix)), `${entry.name} changed ${path}`).toBe(true);
      }
    });
  }

  it("a state-writing subcommand really writes the state file, so the declared path is true", () => {
    const repo = makeReleaseRepo();
    const before = snapshot(repo.work);
    repo.run(["preflight"]);
    expect(changedPaths(before, snapshot(repo.work))).toContain(".git/release-state.json");
  });

  it("covers every release subcommand", () => {
    expect(entries).toHaveLength(9);
  });
});
