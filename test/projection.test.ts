import { lstat, mkdir, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { OpenClawPaths } from "../src/paths.ts";
import {
  buildOpenClawProjectionTargets,
  isProjectionProfileSet,
  runOpenClawProjection,
} from "../src/projection.ts";
import { buildScanDirs } from "../src/scan-dirs.ts";

function fakePaths(root: string): OpenClawPaths {
  const openclawDir = join(root, ".openclaw");
  const cacheDir = join(openclawDir, "cache");
  return {
    openclawDir,
    cacheDir,
    cachePath: join(cacheDir, "skill-router.json"),
    telemetryPath: join(cacheDir, "skill-router-telemetry.json"),
    tracesDir: join(cacheDir, "skill-router-traces"),
    modelsDir: join(cacheDir, "models"),
    managedSkillsDir: join(openclawDir, "workspace", "skills"),
    globalRulesDir: join(openclawDir, "rules"),
    defaultOriginRoot: join(root, ".memex"),
  };
}

describe("projection profile gate", () => {
  it("is off when sync.enabled is false (default)", () => {
    expect(isProjectionProfileSet(DEFAULT_CONFIG)).toBe(false);
  });

  it("is on when sync.enabled is true", () => {
    expect(
      isProjectionProfileSet({
        ...DEFAULT_CONFIG,
        sync: { ...DEFAULT_CONFIG.sync, enabled: true },
      }),
    ).toBe(true);
  });
});

describe("buildOpenClawProjectionTargets", () => {
  it("projects global rules only by default (no double-index)", () => {
    const paths = fakePaths("/tmp/oc-paths");
    const targets = buildOpenClawProjectionTargets(paths);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.id).toBe("openclaw-global-rules");
    expect(targets[0]!.targetDir).toBe(paths.globalRulesDir);
    expect(targets[0]!.originRelDir).toBe("rules");
    expect(targets[0]!.entryKind).toBe("files");
  });

  it("adds workspace rules only when projectOriginRelDir is explicit", () => {
    const paths = fakePaths("/tmp/oc-p");
    const targets = buildOpenClawProjectionTargets(paths, {
      workspaceDir: "/work/ws",
      projectOriginRelDir: "projects/foo/rules",
    });
    expect(targets.map((t) => t.id)).toEqual(["openclaw-global-rules", "openclaw-workspace-rules"]);
    expect(targets[1]!.originRelDir).toBe("projects/foo/rules");
    expect(targets[1]!.targetDir).toBe(join("/work/ws", "rules"));
  });
});

describe("buildScanDirs scan policy", () => {
  it("keeps ruleDirs empty when projection idle", () => {
    const paths = fakePaths("/tmp/scan");
    const dirs = buildScanDirs("/ws", DEFAULT_CONFIG, paths);
    expect(dirs.ruleDirs).toEqual([]);
    expect(dirs.skillDirs[0]).toBe(join("/ws", "skills"));
    expect(dirs.skillDirs[1]).toBe(paths.managedSkillsDir);
  });

  it("includes globalRulesDir only when profile set (never raw origin)", () => {
    const paths = fakePaths("/tmp/scan2");
    const config = {
      ...DEFAULT_CONFIG,
      sync: { ...DEFAULT_CONFIG.sync, enabled: true, repoDir: join("/tmp/scan2", "origin") },
    };
    const dirs = buildScanDirs("/ws", config, paths);
    expect(dirs.ruleDirs).toEqual([paths.globalRulesDir]);
    expect(dirs.ruleDirs.some((d) => d.includes("origin"))).toBe(false);
  });
});

describe("runOpenClawProjection", () => {
  let root: string;
  let paths: OpenClawPaths;

  beforeEach(async () => {
    root = join(tmpdir(), `oc-proj-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(root, { recursive: true });
    paths = fakePaths(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("no-ops with clear message when profile not set", async () => {
    const report = await runOpenClawProjection({
      config: DEFAULT_CONFIG,
      paths,
      homeDir: root,
    });
    expect(report.profileSet).toBe(false);
    expect(report.apply).toBeNull();
    expect(report.message).toMatch(/sync\.enabled=false/);
  });

  it("creates absolute symlinks from origin rules into ~/.openclaw/rules", async () => {
    const origin = join(root, "origin");
    await mkdir(join(origin, "rules"), { recursive: true });
    await writeFile(join(origin, "rules", "dogfood.md"), "# dogfood\n", "utf8");

    const report = await runOpenClawProjection({
      config: {
        ...DEFAULT_CONFIG,
        sync: {
          ...DEFAULT_CONFIG.sync,
          enabled: true,
          repoDir: origin,
          autoPull: false,
        },
      },
      paths,
      homeDir: root,
    });

    expect(report.profileSet).toBe(true);
    expect(report.apply?.linked).toBe(1);
    expect(report.apply?.conflicts).toEqual([]);

    const linkPath = join(paths.globalRulesDir, "dogfood.md");
    const st = await lstat(linkPath);
    expect(st.isSymbolicLink()).toBe(true);
    const target = await readlink(linkPath);
    expect(target).toBe(join(origin, "rules", "dogfood.md"));
  });

  it("does not clobber a real file (conflict, partial apply)", async () => {
    const origin = join(root, "origin");
    await mkdir(join(origin, "rules"), { recursive: true });
    await writeFile(join(origin, "rules", "a.md"), "origin-a\n", "utf8");
    await writeFile(join(origin, "rules", "b.md"), "origin-b\n", "utf8");
    await mkdir(paths.globalRulesDir, { recursive: true });
    await writeFile(join(paths.globalRulesDir, "a.md"), "local-real\n", "utf8");

    const report = await runOpenClawProjection({
      config: {
        ...DEFAULT_CONFIG,
        sync: {
          ...DEFAULT_CONFIG.sync,
          enabled: true,
          repoDir: origin,
          autoPull: false,
        },
      },
      paths,
      homeDir: root,
    });

    expect(report.apply?.conflicts.some((c) => c.reason === "real-file")).toBe(true);
    const b = join(paths.globalRulesDir, "b.md");
    expect((await lstat(b)).isSymbolicLink()).toBe(true);
    expect((await lstat(join(paths.globalRulesDir, "a.md"))).isSymbolicLink()).toBe(false);
  });

  it("dry-run does not create links", async () => {
    const origin = join(root, "origin");
    await mkdir(join(origin, "rules"), { recursive: true });
    await writeFile(join(origin, "rules", "x.md"), "x\n", "utf8");

    const report = await runOpenClawProjection({
      config: {
        ...DEFAULT_CONFIG,
        sync: {
          ...DEFAULT_CONFIG.sync,
          enabled: true,
          repoDir: origin,
          autoPull: false,
        },
      },
      paths,
      homeDir: root,
      dryRun: true,
    });

    expect(report.plan?.links.length).toBeGreaterThan(0);
    expect(report.apply).toBeNull();
    await expect(lstat(join(paths.globalRulesDir, "x.md"))).rejects.toThrow();
  });
});
