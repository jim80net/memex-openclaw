// Cross-adapter version-pin alignment guard.
// This proves declared range + installed resolution match the published Core contract.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CROSS_ADAPTER_TRANSFORMERS_RANGE = "^3.8.1";
const CROSS_ADAPTER_TRANSFORMERS_RESOLVED = "3.8.1";
const CROSS_ADAPTER_MEMEX_CORE_RANGE = "^0.7.1";
const CROSS_ADAPTER_MEMEX_CORE_RESOLVED = "0.7.1";
const SAFE_SHARP_RESOLVED = "0.35.3";

function readJson(relFromRepoRoot: string): Record<string, unknown> {
  const url = new URL(`../${relFromRepoRoot}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf-8")) as Record<string, unknown>;
}

function depRange(pkg: Record<string, unknown>, name: string): string | undefined {
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    const block = pkg[field];
    if (block && typeof block === "object") {
      const v = (block as Record<string, string>)[name];
      if (typeof v === "string") return v;
    }
  }
  return undefined;
}

describe("cross-adapter version-pin alignment (G3 openclaw)", () => {
  const openclawPkg = readJson("package.json");

  describe("declared ranges match the cross-adapter reference (documentary)", () => {
    it("@huggingface/transformers range", () => {
      expect(depRange(openclawPkg, "@huggingface/transformers")).toBe(
        CROSS_ADAPTER_TRANSFORMERS_RANGE,
      );
    });
    it("@jim80net/memex-core range", () => {
      expect(depRange(openclawPkg, "@jim80net/memex-core")).toBe(CROSS_ADAPTER_MEMEX_CORE_RANGE);
    });
  });

  describe("resolved/installed versions match (load-bearing)", () => {
    it("the INSTALLED @huggingface/transformers version equals the reference", () => {
      const installed = readJson("node_modules/@huggingface/transformers/package.json");
      expect(installed.version).toBe(CROSS_ADAPTER_TRANSFORMERS_RESOLVED);
    });

    it("the INSTALLED @jim80net/memex-core version equals the reference", () => {
      const installed = readJson("node_modules/@jim80net/memex-core/package.json");
      expect(installed.version).toBe(CROSS_ADAPTER_MEMEX_CORE_RESOLVED);
    });

    it("openclaw's transformers range equals the INSTALLED memex-core's range", () => {
      const corePkg = readJson("node_modules/@jim80net/memex-core/package.json");
      const coreRange = depRange(corePkg, "@huggingface/transformers");
      expect(coreRange, "@huggingface/transformers missing from memex-core pkg").toBeDefined();
      expect(depRange(openclawPkg, "@huggingface/transformers")).toBe(coreRange);
    });

    it("the application override resolves Transformers to safe Sharp", () => {
      const pnpmConfig = openclawPkg.pnpm as { overrides?: Record<string, string> } | undefined;
      expect(pnpmConfig?.overrides?.["@huggingface/transformers>sharp"]).toBe(SAFE_SHARP_RESOLVED);

      const transformersPackageUrl = new URL(
        "../node_modules/@huggingface/transformers/package.json",
        import.meta.url,
      );
      const requireFromTransformers = createRequire(transformersPackageUrl);
      const sharpEntry = requireFromTransformers.resolve("sharp");
      const sharpPkg = JSON.parse(
        readFileSync(join(dirname(sharpEntry), "..", "package.json"), "utf-8"),
      ) as Record<string, unknown>;
      expect(sharpPkg.version).toBe(SAFE_SHARP_RESOLVED);
    });
  });
});
