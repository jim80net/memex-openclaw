import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  approveReleasePullRequestRun,
  selectHeldPullRequestRun,
  type WorkflowRun,
} from "../scripts/approve-release-pr-run.mjs";

const repository = "jim80net/memex-openclaw";
const headBranch = "release-please--branches--main";
const headSha = "abc123";
const releasePr = JSON.stringify({ number: 27, headBranchName: headBranch });

function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 42,
    event: "pull_request",
    status: "action_required",
    head_branch: headBranch,
    head_sha: headSha,
    ...overrides,
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function api(workflowRuns: WorkflowRun[] | WorkflowRun[][]) {
  const requests: Array<{ method: string; url: string }> = [];
  const responses = Array.isArray(workflowRuns[0])
    ? (workflowRuns as WorkflowRun[][])
    : [workflowRuns as WorkflowRun[]];
  let poll = 0;
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push({ method, url });
    if (url.endsWith("/pulls/27")) {
      return json({ head: { ref: headBranch, sha: headSha, repo: { full_name: repository } } });
    }
    if (url.includes("/actions/workflows/ci.yml/runs?")) {
      const response = responses[Math.min(poll, responses.length - 1)] ?? [];
      poll += 1;
      return json({ workflow_runs: response });
    }
    if (url.endsWith("/actions/runs/42/approve") && method === "POST") {
      return new Response(null, { status: 201 });
    }
    return new Response("unexpected request", { status: 500 });
  });
  return { fetchImpl: fetchImpl as typeof fetch, requests };
}

describe("release PR held-run approval", () => {
  it("approves only the exact held pull_request CI run", async () => {
    const client = api([
      run({ id: 7, event: "workflow_dispatch" }),
      run({ id: 8, head_sha: "stale" }),
      run(),
    ]);

    const result = await approveReleasePullRequestRun({
      releasePr,
      repository,
      token: "test-token",
      apiUrl: "https://api.github.test",
      fetchImpl: client.fetchImpl,
      maxAttempts: 1,
    });

    expect(result).toEqual({ runId: 42, headBranch, headSha });
    expect(client.requests.filter(({ method }) => method === "POST")).toEqual([
      {
        method: "POST",
        url: `https://api.github.test/repos/${repository}/actions/runs/42/approve`,
      },
    ]);
    const runsRequest = client.requests.find(({ url }) =>
      url.includes("/actions/workflows/ci.yml/runs?"),
    );
    expect(runsRequest?.url).toContain("event=pull_request");
    expect(runsRequest?.url).toContain("status=action_required");
  });

  it("approves a held run that materializes late in the widened polling window", async () => {
    const delayedResponses: WorkflowRun[][] = Array.from({ length: 29 }, () => []);
    delayedResponses.push([run()]);
    const client = api(delayedResponses);
    const sleep = vi.fn(async () => {});

    const result = await approveReleasePullRequestRun({
      releasePr,
      repository,
      token: "test-token",
      apiUrl: "https://api.github.test",
      fetchImpl: client.fetchImpl,
      sleep,
    });

    expect(result).toEqual({ runId: 42, headBranch, headSha });
    expect(sleep).toHaveBeenCalledTimes(29);
    expect(sleep).toHaveBeenCalledWith(10_000);
    expect(
      client.requests.filter(
        ({ method, url }) => method === "GET" && url.includes("/actions/workflows/ci.yml/runs?"),
      ),
    ).toHaveLength(30);
    expect(client.requests.filter(({ method }) => method === "POST")).toHaveLength(1);
  });

  it("fails the planted dispatch-only negative control", async () => {
    const client = api([run({ id: 7, event: "workflow_dispatch" })]);

    await expect(
      approveReleasePullRequestRun({
        releasePr,
        repository,
        token: "test-token",
        apiUrl: "https://api.github.test",
        fetchImpl: client.fetchImpl,
        maxAttempts: 1,
      }),
    ).rejects.toThrow("workflow_dispatch runs are intentionally ineligible");
    expect(client.requests.some(({ method }) => method === "POST")).toBe(false);
  });

  it("fails closed when more than one exact held run exists", () => {
    expect(() =>
      selectHeldPullRequestRun([run({ id: 41 }), run({ id: 42 })], { headBranch, headSha }),
    ).toThrow("ambiguous held CI runs");
  });

  it("wires approval into Release Please without a dispatch fallback", async () => {
    const workflow = await readFile(".github/workflows/release-please.yml", "utf8");
    expect(workflow).toMatch(/release-please:\n(?:\s+.*\n)*?\s+actions: write/);
    expect(workflow).toContain("if: steps.release.outputs.prs_created == 'true'");
    expect(workflow).toContain("run: node scripts/approve-release-pr-run.mjs");
    expect(workflow).not.toContain("workflow_dispatch");
    expect(workflow).not.toContain("gh workflow run");
  });
});
