import type { ProjectionRunReport } from "./projection.ts";

/** Format a projection run as an operator-readable Markdown preflight. */
export function formatProjectionReport(
  report: ProjectionRunReport,
  opts: { dryRun: boolean },
): string {
  const links = report.plan?.links ?? [];
  const conflicts = report.plan?.conflicts ?? report.apply?.conflicts ?? [];
  const pending = links.filter((link) => link.action === "create" || link.action === "relink");
  const unchanged = links.filter((link) => link.action === "noop");
  const state = conflicts.length > 0 ? "BLOCKED" : pending.length > 0 ? "CHANGES READY" : "READY";
  const lines = [
    "# OpenClaw rules projection preflight",
    "",
    `- **Status:** ${state}`,
    `- **Mode:** ${opts.dryRun ? "plan only (no files changed)" : "applied"}`,
    `- **Origin:** ${report.origin?.root ?? "not resolved"}`,
    `- **Origin source:** ${report.origin?.source ?? "not resolved"}`,
    `- **Planned changes:** ${pending.length}`,
    `- **Already current:** ${unchanged.length}`,
    `- **Conflicts:** ${conflicts.length}`,
  ];

  if (links.length > 0) {
    lines.push(
      "",
      "## Link plan",
      "",
      "| Action | Rule source | OpenClaw target |",
      "|---|---|---|",
    );
    for (const link of links) {
      lines.push(`| ${link.action} | \`${link.originPath}\` | \`${link.targetPath}\` |`);
    }
  }

  if (conflicts.length > 0) {
    lines.push("", "## Conflicts", "");
    for (const conflict of conflicts) {
      lines.push(`- \`${conflict.targetPath}\`: ${conflict.reason}`);
    }
  }

  return lines.join("\n");
}
