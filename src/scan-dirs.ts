/**
 * Projection-aware ScanDirs builder for OpenClaw.
 *
 * When sync profile is set: scan ~/.openclaw/rules (links resolve to origin).
 * Never also scan raw origin/rules — one content blob → one index entry.
 */

import type { ScanDirs } from "@jim80net/memex-core";
import type { SkillRouterConfig } from "./config.ts";
import { getOpenClawPaths, getWorkspaceSkillsDir, type OpenClawPaths } from "./paths.ts";
import { rulesProjectionActive } from "./projection.ts";

export function buildScanDirs(
  workspaceDir: string,
  config: SkillRouterConfig,
  paths: OpenClawPaths = getOpenClawPaths(),
): ScanDirs {
  const ruleDirs = rulesProjectionActive(config) ? [paths.globalRulesDir] : [];
  return {
    skillDirs: [getWorkspaceSkillsDir(workspaceDir), paths.managedSkillsDir, ...config.skillDirs],
    memoryDirs: [...config.memoryDirs],
    ruleDirs,
  };
}
