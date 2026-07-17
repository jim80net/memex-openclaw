#!/usr/bin/env node
/**
 * Offline rules projection for OpenClaw (dogfood / CI).
 *
 * Usage:
 *   node scripts/project-rules.mjs [--dry-run] [--strict] [--report]
 *
 * Reads MEMEX_OPENCLAW_SYNC_JSON or defaults to sync.enabled=true with
 * resolveOriginRoot defaults. Does not require the OpenClaw gateway.
 */

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Load compiled-less TS via Node --experimental-strip-types if available,
// else expect dist. Prefer dynamic import of source under Node 22+.
const dryRun = process.argv.includes("--dry-run");
const strict = process.argv.includes("--strict");
const reportMode = process.argv.includes("--report");

async function loadProjection() {
  try {
    return await import(pathToFileURL(join(root, "src/projection.ts")).href);
  } catch {
    return await import(pathToFileURL(join(root, "src/projection.js")).href);
  }
}

async function loadConfig() {
  try {
    return await import(pathToFileURL(join(root, "src/config.ts")).href);
  } catch {
    return await import(pathToFileURL(join(root, "src/config.js")).href);
  }
}

async function loadPaths() {
  try {
    return await import(pathToFileURL(join(root, "src/paths.ts")).href);
  } catch {
    return await import(pathToFileURL(join(root, "src/paths.js")).href);
  }
}

async function loadReportFormatter() {
  try {
    return await import(pathToFileURL(join(root, "src/projection-report.ts")).href);
  } catch {
    return await import(pathToFileURL(join(root, "src/projection-report.js")).href);
  }
}

async function main() {
  const { runOpenClawProjection } = await loadProjection();
  const { DEFAULT_CONFIG } = await loadConfig();
  const { getOpenClawPaths } = await loadPaths();
  const { formatProjectionReport } = await loadReportFormatter();

  let syncOverride = {};
  if (process.env.MEMEX_OPENCLAW_SYNC_JSON) {
    syncOverride = JSON.parse(process.env.MEMEX_OPENCLAW_SYNC_JSON);
  }

  const config = {
    ...DEFAULT_CONFIG,
    sync: {
      ...DEFAULT_CONFIG.sync,
      enabled: true,
      ...syncOverride,
    },
  };

  const paths = getOpenClawPaths(homedir());
  const report = await runOpenClawProjection({
    config,
    paths,
    dryRun,
  });

  if (reportMode) {
    console.log(formatProjectionReport(report, { dryRun }));
  } else {
    console.log(report.message);
  }
  if (!reportMode && report.apply?.conflicts?.length) {
    for (const c of report.apply.conflicts) {
      console.warn(`conflict: ${c.targetPath} (${c.reason})`);
    }
  }

  if (strict) {
    if (!report.profileSet) process.exit(2);
    if (report.apply && report.apply.conflicts.length > 0) process.exit(1);
    const pending = report.plan?.links.filter((l) => l.action === "create" || l.action === "relink")
      .length;
    if (dryRun && pending > 0) process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
