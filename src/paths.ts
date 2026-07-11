/**
 * OpenClaw-specific paths — single source of truth for harness dirs.
 *
 * Design: docs/design/2026-07-11-g3-adapter-alignment-file-rules.md
 * Verified constants historically lived in index.ts; centralized here for
 * projection + scan policy without inventing freestanding trees.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { defaultOriginRoot } from "@jim80net/memex-core";

export type OpenClawPaths = {
  openclawDir: string;
  cacheDir: string;
  cachePath: string;
  telemetryPath: string;
  tracesDir: string;
  modelsDir: string;
  /** Global skills: ~/.openclaw/workspace/skills */
  managedSkillsDir: string;
  /**
   * Memex-managed rules projection target under OpenClaw home.
   * Not a pre-existing OpenClaw product dir — see design §4.2.
   */
  globalRulesDir: string;
  /**
   * Product-default origin path (`~/.memex` via core). Live origin uses
   * resolveOriginRoot at runtime — do not treat this alone as the live root.
   */
  defaultOriginRoot: string;
};

export function getOpenClawPaths(homeDir: string = homedir()): OpenClawPaths {
  const openclawDir = join(homeDir, ".openclaw");
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
    defaultOriginRoot: defaultOriginRoot(homeDir),
  };
}

/** Workspace-scoped skills dir (OpenClaw workspaceDir/skills). */
export function getWorkspaceSkillsDir(workspaceDir: string): string {
  return join(workspaceDir, "skills");
}

/** Workspace-scoped rules dir — only used when explicit project origin scope is set. */
export function getWorkspaceRulesDir(workspaceDir: string): string {
  return join(workspaceDir, "rules");
}
