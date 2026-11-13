import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { checkPage, root } from "../helpers/doc-pages";

// docs/adapters.md is the page of two parts, `/vue` and `/svelte`. Its only figures are the peer ranges, which come from package.json.

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { peerDependencies: Record<string, string> };

checkPage("adapters.md", [
  {
    text: "The supported ranges are Vue `^3.5.0` and Svelte `^5.0.0`.",
    check: () => {
      expect(pkg.peerDependencies.vue).toBe("^3.5.0");
      expect(pkg.peerDependencies.svelte).toBe("^5.0.0");
    },
  },
]);
