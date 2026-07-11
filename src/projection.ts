/**
 * OpenClaw harness projection — thin adapter over memex-core origin primitives.
 *
 * Design: docs/design/2026-07-11-g3-adapter-alignment-file-rules.md
 * Core: resolveOriginRoot / planProjection / applyProjection (@jim80net/memex-core@0.6+)
 *
 * Does not invent a parallel origin layout. No default ~/.memex migrate (CoS C).
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type ApplyProjectionResult,
  applyProjection,
  initSyncRepo,
  type ProjectionTarget,
  type ProjectPlan,
  planProjection,
  type ResolvedOriginRoot,
  resolveOriginRoot,
  type SyncConfig,
  syncPull,
} from "@jim80net/memex-core";
import type { SkillRouterConfig } from "./config.ts";
import { getOpenClawPaths, getWorkspaceRulesDir, type OpenClawPaths } from "./paths.ts";

export type ProjectionRunOptions = {
  config: SkillRouterConfig;
  /** Project cwd / workspace for optional project-scoped rules. */
  workspaceDir?: string;
  paths?: OpenClawPaths;
  /** When true, plan only — do not apply or mkdir origin. */
  dryRun?: boolean;
  /** Override home for resolveOriginRoot (tests). */
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
};

export type ProjectionRunReport = {
  profileSet: boolean;
  origin: ResolvedOriginRoot | null;
  plan: ProjectPlan | null;
  apply: ApplyProjectionResult | null;
  pullMessage: string | null;
  message: string;
};

/** Profile is set when adapter sync is enabled (maps to SyncProfile.enabled). */
export function isProjectionProfileSet(config: SkillRouterConfig): boolean {
  return config.sync.enabled === true;
}

/**
 * Build harness projection targets for OpenClaw.
 *
 * v1: global `~/.openclaw/rules` only. Project `workspaceDir/rules` only when
 * callers pass an explicit `projectOriginRelDir` (avoids double-index of the
 * same origin rules/ tree).
 */
export function buildOpenClawProjectionTargets(
  paths: OpenClawPaths = getOpenClawPaths(),
  opts: { workspaceDir?: string; projectOriginRelDir?: string } = {},
): ProjectionTarget[] {
  const targets: ProjectionTarget[] = [
    {
      id: "openclaw-global-rules",
      targetDir: paths.globalRulesDir,
      originRelDir: "rules",
      entryKind: "files",
      pattern: "*.md",
      initTargetDir: true,
    },
  ];
  if (opts.projectOriginRelDir && opts.workspaceDir) {
    targets.push({
      id: "openclaw-workspace-rules",
      targetDir: getWorkspaceRulesDir(opts.workspaceDir),
      originRelDir: opts.projectOriginRelDir,
      entryKind: "files",
      pattern: "*.md",
      initTargetDir: true,
    });
  }
  return targets;
}

/** Map adapter sync config to core SyncConfig for initSyncRepo / syncPull. */
export function toCoreSyncConfig(config: SkillRouterConfig): SyncConfig {
  return {
    enabled: config.sync.enabled,
    repo: config.sync.repo ?? "",
    autoPull: config.sync.autoPull,
    autoCommitPush: config.sync.autoCommitPush,
    projectMappings: {},
  };
}

/**
 * Resolve live origin root via core resolver (product default ~/.memex).
 * Explicit config.sync.repoDir maps to profile origin.root.
 * Never migrates (CoS C — opt-in only, not v1).
 */
export async function resolveOpenClawOrigin(
  config: SkillRouterConfig,
  opts: { homeDir?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<ResolvedOriginRoot> {
  const root =
    typeof config.sync.repoDir === "string" && config.sync.repoDir.trim() !== ""
      ? config.sync.repoDir
      : undefined;
  return resolveOriginRoot({
    root,
    homeDir: opts.homeDir,
    env: opts.env,
  });
}

/**
 * Ensure origin exists, optionally pull remote, plan + apply rules projection.
 */
export async function runOpenClawProjection(
  opts: ProjectionRunOptions,
): Promise<ProjectionRunReport> {
  const { config } = opts;
  const paths = opts.paths ?? getOpenClawPaths(opts.homeDir);
  const dryRun = opts.dryRun === true;

  if (!isProjectionProfileSet(config)) {
    return {
      profileSet: false,
      origin: null,
      plan: null,
      apply: null,
      pullMessage: null,
      message:
        "sync profile not set (sync.enabled=false); enable in plugin config to project rules",
    };
  }

  const origin = await resolveOpenClawOrigin(config, {
    homeDir: opts.homeDir,
    env: opts.env,
  });
  const coreSync = toCoreSyncConfig(config);

  if (!dryRun) {
    await mkdir(origin.root, { recursive: true });
    await mkdir(join(origin.root, "rules"), { recursive: true });
    if (coreSync.repo) {
      await initSyncRepo(coreSync, origin.root);
    }
  }

  let pullMessage: string | null = null;
  if (!dryRun && coreSync.repo && coreSync.autoPull) {
    pullMessage = await syncPull(coreSync, origin.root);
  }

  const targets = buildOpenClawProjectionTargets(paths, {
    workspaceDir: opts.workspaceDir,
  });
  const plan = await planProjection(origin.root, targets, { relinkManaged: true });

  if (dryRun) {
    return {
      profileSet: true,
      origin,
      plan,
      apply: null,
      pullMessage,
      message: `dry-run: origin=${origin.root} source=${origin.source} links=${plan.links.length} conflicts=${plan.conflicts.length}`,
    };
  }

  const apply = await applyProjection(plan, { onClobber: "fail-closed" });
  return {
    profileSet: true,
    origin,
    plan,
    apply,
    pullMessage,
    message: `origin=${origin.root} source=${origin.source} linked=${apply.linked} skipped=${apply.skipped} conflicts=${apply.conflicts.length}`,
  };
}

/**
 * Whether rules are expected to be projected into harness dirs (scan policy).
 * When true, buildScanDirs includes globalRulesDir and must not also append
 * raw origin/rules (avoid double-index).
 */
export function rulesProjectionActive(config: SkillRouterConfig): boolean {
  return isProjectionProfileSet(config);
}
