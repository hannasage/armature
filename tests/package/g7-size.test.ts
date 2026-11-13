import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// G7 adds `/css`, `/vue`, and `/svelte`. Each cap is the measured size plus 10 percent, rounded up to the next 10 bytes, and the tech lead approved
// each one on 2026-11-13. No existing cap moves. The peer ranges of Vue and Svelte come from `npm view`, and the baseline page records the commands.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const lib = (await import(pathToFileURL(join(root, "scripts/size-lib.mjs")).href)) as {
  measureAll: () => Promise<{ key: string; gzipped: number }[]>;
  capFor: (gzipped: number) => number;
  measureOwn: (source: string) => Promise<{ gzipped: number }>;
  checkOwnCaps: (budget: unknown) => Promise<string[]>;
  WRAPPED_LAYERS: string[];
};
type Cap = { cap: number; measuredGzipped: number; measuredAfterReview?: number; measuredIn: string; proposal?: string; approval?: string };
type OwnCap = { cap: number; measuredGzipped: number; approval?: string };
type Pkg = {
  name: string;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
  devDependencies: Record<string, string>;
};
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Pkg;
const budget = JSON.parse(readFileSync(join(root, "size-budget.json"), "utf8")) as { caps: Record<string, Cap>; ownCaps?: Record<string, OwnCap>; proposedForNewEntries: Record<string, string> };
const baseline = readFileSync(join(root, "docs/baseline.md"), "utf8");
const section = () => baseline.slice(baseline.indexOf("## G7 build"));
const NEW: Array<[string, string]> = [["css", "2.0 KB"], ["vue", "1.0 KB"], ["svelte", "1.0 KB"]];
const key = (short: string) => `@hannasage/armature/${short}`;
const fmt = (n: number) => n.toLocaleString("en-US");

describe("the sizes after G7", () => {
  it.each(NEW)("gives /%s a cap derived from its measure by the rule, with the amendment proposal beside it", async (short, proposal) => {
    const entry = budget.caps[key(short)];
    expect(entry).toBeDefined();
    expect(entry.cap).toBe(lib.capFor(entry.measuredGzipped));
    expect(entry.measuredIn).toBe("G7 build");
    expect(entry.proposal).toBe(proposal);
    expect(entry.measuredGzipped).toBeLessThanOrEqual(entry.cap);
    const rows = await lib.measureAll();
    expect(rows.find((row) => row.key === key(short))!.gzipped).toBe(entry.measuredAfterReview ?? entry.measuredGzipped);
  });

  it.each(NEW)("records that the tech lead approved the /%s cap, with a date", (short) => {
    expect(budget.caps[key(short)].approval).toMatch(/^approved by the tech lead, \d{4}-\d{2}-\d{2}$/);
  });

  it.each([["vue", 1000], ["svelte", 1000], ["css", 2510]] as Array<[string, number]>)("sets the own-code cap of /%s to %i, and the own code is under it", async (short, cap) => {
    const own = budget.ownCaps![key(short)];
    expect(own.cap).toBe(cap);
    expect(own.approval).toMatch(/^approved by the tech lead, \d{4}-\d{2}-\d{2}$/);
    const measured = await lib.measureOwn(`src/${short}/index.ts`);
    expect(measured.gzipped).toBe(own.measuredGzipped);
    expect(measured.gzipped).toBeLessThanOrEqual(own.cap);
  });

  it("measures own code with the wrapped layers left out, and counts more with them in", async () => {
    for (const [short] of NEW) {
      const own = await lib.measureOwn(`src/${short}/index.ts`);
      const rows = await lib.measureAll();
      expect(own.gzipped, short).toBeLessThan(rows.find((row) => row.key === key(short))!.gzipped / 3);
    }
    expect(lib.WRAPPED_LAYERS).toEqual(["engine", "dom", "gesture", "layout", "timeline", "linear", "curves", "frame"]);
  });

  it("fails check-size logic when own code is over its own-code cap", async () => {
    const problems = await lib.checkOwnCaps({ ownCaps: { [key("vue")]: { cap: 10 } } });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("own-code cap of 10");
    expect(await lib.checkOwnCaps({ ownCaps: { "@hannasage/armature/none": { cap: 10 } } })).toHaveLength(1);
  });

  it("no longer lists the three entries among the entries that do not exist yet", () => {
    for (const [short] of NEW) expect(Object.keys(budget.proposedForNewEntries)).not.toContain(key(short));
  });

  it("writes the figures in docs/baseline.md: each cap, each measure, the approval, and the tarball re-measured", () => {
    const text = section();
    expect(baseline).toContain("## G7 build");
    for (const [short] of NEW) {
      const entry = budget.caps[key(short)];
      expect(text, short).toContain(`- \`/${short}\`: ${fmt(entry.cap)}`);
      expect(text, short).toContain(fmt(entry.measuredAfterReview ?? entry.measuredGzipped));
    }
    expect(text).toMatch(/approved by the tech lead, \d{4}-\d{2}-\d{2}/);
    for (const [short] of NEW) expect(text, short).toContain(fmt(budget.ownCaps![key(short)].measuredGzipped));
    expect(text).toContain("### Own-code caps");
    expect(text).toMatch(/tarball[^\n]*\d{3},\d{3} bytes/i);
    expect(text).toContain("1.5");
    expect(text).toMatch(/222,018/);
  });

  it("keeps the approved size of the tarball as the baseline", () => {
    expect(baseline).toMatch(/MEASURED_SIZE[^\n]*222,018[^\n]*approved by the maintainer/);
  });

  it("leaves the caps of the other entries as they were", () => {
    const keep: Record<string, number> = {
      "@hannasage/armature": 4000, "@hannasage/armature/dom": 12170, "@hannasage/armature/react": 12650, "@hannasage/armature/glass": 8430,
      "@hannasage/armature/glass/react": 13710, "@hannasage/armature/styles.css": 830, "@hannasage/armature/frame": 890,
      "@hannasage/armature/values": 6870, "@hannasage/armature/curves": 2500, "@hannasage/armature/linear": 3690, "@hannasage/armature/gesture": 5850,
      "@hannasage/armature/timeline": 6460, "@hannasage/armature/layout": 6420,
    };
    for (const [name, cap] of Object.entries(keep)) expect(budget.caps[name].cap, name).toBe(cap);
  });

  it("keeps every entry at or under its cap, and the spring-only entry under its cap of 4,000 (3,865 after the stop-once guard)", async () => {
    const rows = await lib.measureAll();
    for (const row of rows) expect(row.gzipped, row.key).toBeLessThanOrEqual(budget.caps[row.key].cap);
    expect(rows.find((row) => row.key === "@hannasage/armature")!.gzipped).toBeLessThanOrEqual(3865);
  });
});

describe("the peer ranges", () => {
  it("make Vue and Svelte optional peers, as React is", () => {
    expect(Object.keys(pkg.peerDependencies).sort()).toEqual(["react", "svelte", "vue"]);
    expect(pkg.peerDependencies.react).toBe(">=18");
    expect(pkg.peerDependencies.vue).toMatch(/^\^3\.\d+\.0$/);
    expect(pkg.peerDependencies.svelte).toMatch(/^\^5\.\d+\.0$/);
    expect(pkg.peerDependenciesMeta).toEqual({ react: { optional: true }, vue: { optional: true }, svelte: { optional: true } });
  });

  it("add Vue and Svelte as dev dependencies only, pinned, and add no runtime dependency", () => {
    expect(pkg.devDependencies.vue).toMatch(/^3\.\d+\.\d+$/);
    expect(pkg.devDependencies.svelte).toMatch(/^5\.\d+\.\d+$/);
    expect(pkg).not.toHaveProperty("dependencies");
  });

  it("have the range strings ^3.5.0 and ^5.0.0 (this test checks the strings only; the floors are tested in the baseline record)", () => {
    expect(pkg.peerDependencies.vue).toBe("^3.5.0");
    expect(pkg.peerDependencies.svelte).toBe("^5.0.0");
  });

  it("are recorded in docs/baseline.md with the npm view commands and their output", () => {
    const text = section();
    expect(text).toContain("### Peer ranges");
    for (const command of ["npm view vue versions", "npm view vue dist-tags", "npm view svelte versions", "npm view svelte dist-tags"]) expect(text, command).toContain(command);
    expect(text).toContain(pkg.peerDependencies.vue);
    expect(text).toContain(pkg.peerDependencies.svelte);
    expect(text).toContain("3.5.45");
    expect(text).toContain("5.57.3");
    expect(text).toMatch(/3\.6\.0-rc/);
  });

  it("records the Svelte test path from the Svelte docs, and the choices where the spec was silent", () => {
    const text = section();
    expect(text).toContain("svelte/server");
    expect(text).toContain("### Choices");
    expect(text).toMatch(/onReady/);
  });
});
