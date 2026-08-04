#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_VERSION = "2022-11-28";
const DEFAULT_ATTEMPTS = 30;
const DEFAULT_INTERVAL_MS = 10_000;

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

export function parseReleasePullRequest(raw) {
  const value = JSON.parse(requiredString(raw, "RELEASE_PR"));
  if (!Number.isInteger(value.number) || value.number <= 0) {
    throw new Error("RELEASE_PR.number must be a positive integer");
  }
  return {
    number: value.number,
    headBranchName: requiredString(
      value.headBranchName,
      "RELEASE_PR.headBranchName",
    ),
  };
}

export function selectHeldPullRequestRun(runs, expected) {
  const matches = runs.filter(
    (run) =>
      Number.isInteger(run.id) &&
      run.id > 0 &&
      run.event === "pull_request" &&
      run.status === "action_required" &&
      run.head_branch === expected.headBranch &&
      run.head_sha === expected.headSha,
  );
  if (matches.length > 1) {
    throw new Error(
      `ambiguous held CI runs for ${expected.headBranch}@${expected.headSha}: ${matches
        .map((run) => run.id)
        .join(", ")}`,
    );
  }
  return matches[0] ?? null;
}

async function githubRequest(fetchImpl, token, url, options = {}) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new Error(
      `GitHub API ${options.method ?? "GET"} ${url} failed (${response.status}): ${await response.text()}`,
    );
  }
  if (response.status === 204 || response.status === 201) return null;
  return response.json();
}

export async function approveReleasePullRequestRun(options) {
  const releasePr = parseReleasePullRequest(options.releasePr);
  const repository = requiredString(options.repository, "GITHUB_REPOSITORY");
  const token = requiredString(options.token, "GH_TOKEN");
  const apiUrl = requiredString(options.apiUrl, "GITHUB_API_URL").replace(
    /\/$/,
    "",
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ??
    ((ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)));
  const maxAttempts = options.maxAttempts ?? DEFAULT_ATTEMPTS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;

  const pull = await githubRequest(
    fetchImpl,
    token,
    `${apiUrl}/repos/${repository}/pulls/${releasePr.number}`,
  );
  const headBranch = requiredString(pull?.head?.ref, "release PR head.ref");
  const headSha = requiredString(pull?.head?.sha, "release PR head.sha");
  const headRepository = requiredString(
    pull?.head?.repo?.full_name,
    "release PR head.repo.full_name",
  );
  if (
    headBranch !== releasePr.headBranchName ||
    headRepository !== repository
  ) {
    throw new Error(
      `release PR head mismatch: output=${releasePr.headBranchName}, API=${headRepository}:${headBranch}`,
    );
  }

  const query = new URLSearchParams({
    branch: headBranch,
    event: "pull_request",
    status: "action_required",
    per_page: "100",
  });
  const runsUrl = `${apiUrl}/repos/${repository}/actions/workflows/ci.yml/runs?${query}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await githubRequest(fetchImpl, token, runsUrl);
    const runs = Array.isArray(response?.workflow_runs)
      ? response.workflow_runs
      : [];
    const run = selectHeldPullRequestRun(runs, { headBranch, headSha });
    if (run) {
      await githubRequest(
        fetchImpl,
        token,
        `${apiUrl}/repos/${repository}/actions/runs/${run.id}/approve`,
        { method: "POST" },
      );
      return { runId: run.id, headBranch, headSha };
    }
    if (attempt < maxAttempts) await sleep(intervalMs);
  }

  throw new Error(
    `no held pull_request CI run appeared for ${headBranch}@${headSha}; workflow_dispatch runs are intentionally ineligible`,
  );
}

async function main() {
  const result = await approveReleasePullRequestRun({
    releasePr: process.env.RELEASE_PR,
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GH_TOKEN,
    apiUrl: process.env.GITHUB_API_URL ?? "https://api.github.com",
  });
  console.log(
    `approved held release-PR CI run ${result.runId} for ${result.headBranch}@${result.headSha}`,
  );
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
