import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = resolve("scripts/verify-lock-policy.mjs");
const PACKAGE_MANAGER = "pnpm@10.34.5";
const roots = new Set<string>();

function fixture(packageManager = PACKAGE_MANAGER) {
  const root = mkdtempSync(join(tmpdir(), "memex-openclaw-lock-policy-"));
  roots.add(root);
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ packageManager })}\n`);
  writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  return root;
}

function verify(root: string) {
  return spawnSync(process.execPath, [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, MEMEX_LOCK_POLICY_ROOT: root },
  });
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
});

describe("lock policy", () => {
  it("accepts the exact pnpm version and sole canonical lockfile", () => {
    const result = verify(fixture());
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(PACKAGE_MANAGER);
  });

  it("rejects a second package-manager lockfile", () => {
    const root = fixture();
    writeFileSync(join(root, "package-lock.json"), "{}\n");
    const result = verify(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("package-lock.json");
  });

  it("rejects a nested pnpm lockfile", () => {
    const root = fixture();
    const nested = join(root, "packages", "fixture");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    const result = verify(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("packages/fixture/pnpm-lock.yaml");
  });

  it("rejects a noncanonical pnpm version", () => {
    const result = verify(fixture("pnpm@10"));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`packageManager must be exactly ${PACKAGE_MANAGER}`);
  });
});
