import { describe, expect, it } from "vitest";
import type { ProjectionRunReport } from "../src/projection.ts";
import { formatProjectionReport } from "../src/projection-report.ts";

function report(overrides: Partial<ProjectionRunReport> = {}): ProjectionRunReport {
  return {
    profileSet: true,
    origin: { root: "/origin", source: "explicit" } as ProjectionRunReport["origin"],
    plan: { ensureDirs: [], links: [], conflicts: [] },
    apply: null,
    pullMessage: null,
    message: "",
    ...overrides,
  };
}

describe("formatProjectionReport", () => {
  it("shows a ready dry-run when every link is current", () => {
    const output = formatProjectionReport(
      report({
        plan: {
          ensureDirs: [],
          links: [
            {
              action: "noop",
              originPath: "/origin/rules/a.md",
              targetPath: "/openclaw/rules/a.md",
            },
          ],
          conflicts: [],
        },
      }),
      { dryRun: true },
    );

    expect(output).toContain("**Status:** READY");
    expect(output).toContain("plan only (no files changed)");
    expect(output).toContain("**Already current:** 1");
  });

  it("shows pending creates as changes ready", () => {
    const output = formatProjectionReport(
      report({
        plan: {
          ensureDirs: [],
          links: [
            {
              action: "create",
              originPath: "/origin/rules/new.md",
              targetPath: "/openclaw/rules/new.md",
            },
          ],
          conflicts: [],
        },
      }),
      { dryRun: true },
    );

    expect(output).toContain("**Status:** CHANGES READY");
    expect(output).toContain("**Planned changes:** 1");
    expect(output).toContain("| create | `/origin/rules/new.md` | `/openclaw/rules/new.md` |");
  });

  it("surfaces fail-closed conflicts", () => {
    const output = formatProjectionReport(
      report({
        plan: {
          ensureDirs: [],
          links: [],
          conflicts: [
            {
              targetPath: "/openclaw/rules/local.md",
              originPath: "/origin/rules/local.md",
              reason: "real-file",
            },
          ],
        },
      }),
      { dryRun: true },
    );

    expect(output).toContain("**Status:** BLOCKED");
    expect(output).toContain("`/openclaw/rules/local.md`: real-file");
  });
});
