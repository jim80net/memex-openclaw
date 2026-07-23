// Cross-adapter version-pin alignment guard.
// This proves declared range + installed resolution match the published Core contract.

import { readFileSync } from "node:fs";
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

    it("the adapter bundles patched Core and Transformers manifests", () => {
      const corePkg = readJson("node_modules/@jim80net/memex-core/package.json");
      const transformersPkg = readJson("node_modules/@huggingface/transformers/package.json");
      expect(depRange(corePkg, "@huggingface/transformers")).toBeUndefined();
      expect(depRange(transformersPkg, "sharp")).toBeUndefined();
      expect(openclawPkg.bundleDependencies).toEqual([
        "@huggingface/transformers",
        "@jim80net/memex-core",
      ]);
      const pnpmConfig = openclawPkg.pnpm as
        | {
            patchedDependencies?: Record<string, string>;
          }
        | undefined;
      expect(pnpmConfig?.patchedDependencies).toEqual({
        "@huggingface/transformers@3.8.1": "patches/@huggingface__transformers@3.8.1.patch",
        "@jim80net/memex-core@0.7.1": "patches/@jim80net__memex-core@0.7.1.patch",
      });
    });

    it("the application directly owns the safe Sharp runtime", () => {
      expect(depRange(openclawPkg, "sharp")).toBe(SAFE_SHARP_RESOLVED);
      expect(depRange(openclawPkg, "@huggingface/jinja")).toBe("^0.5.3");
      expect(depRange(openclawPkg, "onnxruntime-node")).toBe("1.21.0");
      expect(depRange(openclawPkg, "onnxruntime-web")).toBe("1.22.0-dev.20250409-89f8206ba4");
      const sharpPkg = readJson("node_modules/sharp/package.json");
      expect(sharpPkg.version).toBe(SAFE_SHARP_RESOLVED);
    });
  });
});
