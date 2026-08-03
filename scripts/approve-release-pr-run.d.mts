export type WorkflowRun = {
  id: number;
  event: string;
  status: string;
  head_branch: string;
  head_sha: string;
};

export function parseReleasePullRequest(raw: string): {
  number: number;
  headBranchName: string;
};

export function selectHeldPullRequestRun(
  runs: WorkflowRun[],
  expected: { headBranch: string; headSha: string },
): WorkflowRun | null;

export function approveReleasePullRequestRun(options: {
  releasePr: string;
  repository: string;
  token: string;
  apiUrl: string;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  maxAttempts?: number;
  intervalMs?: number;
}): Promise<{ runId: number; headBranch: string; headSha: string }>;
