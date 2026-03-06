import simpleGit from "simple-git";
import { logger } from "../utils/logger";
import { fetchWithRetry } from "../utils/http";

export function parseOwnerRepo(repo: string): { owner: string; repo: string } {
  // Handle SSH: git@github.com:owner/repo.git
  const sshMatch = repo.match(/^git@github\.com:([^/]+)\/([^/.]+)/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  // Handle HTTPS using URL class
  try {
    const url = new URL(repo);
    if (url.hostname !== "github.com") {
      throw new Error(`Not a GitHub URL: ${repo}`);
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2) {
      throw new Error(`Cannot parse owner/repo from path: ${url.pathname}`);
    }
    const repoName = segments[1].replace(/\.git$/, "");
    return { owner: segments[0], repo: repoName };
  } catch (err) {
    if (err instanceof TypeError) {
      // Not a valid URL — fall through
    } else {
      throw err;
    }
  }

  throw new Error(`Cannot parse owner/repo from: ${repo}`);
}

export async function commitAll(
  worktreePath: string,
  message: string,
): Promise<void> {
  const git = simpleGit(worktreePath);
  await git.add([".", ":!.claude-history.json"]);
  await git.commit(message);
  logger.info({ worktreePath, message }, "Committed changes");
}

export async function pushBranch(
  worktreePath: string,
  branch: string,
): Promise<void> {
  const git = simpleGit(worktreePath);
  await git.push("origin", branch);
  logger.info({ worktreePath, branch }, "Pushed branch");
}

export async function amendAndForcePush(
  worktreePath: string,
  branch: string,
): Promise<void> {
  const git = simpleGit(worktreePath);
  await git.add("-A");
  await git.commit("", { "--amend": null, "--no-edit": null });
  await git.push("origin", branch, ["--force"]);
  logger.info({ worktreePath, branch }, "Amended and force-pushed");
}

export interface PROptions {
  repo: string;
  branch: string;
  baseBranch?: string;
  title: string;
  body: string;
  labels?: string[];
  reviewers?: string[];
  githubToken: string;
}

export interface PRResult {
  url: string;
  number: number;
}

export async function createPR(
  _worktreePath: string,
  options: PROptions,
): Promise<PRResult> {
  const { owner, repo } = parseOwnerRepo(options.repo);
  const base = options.baseBranch ?? "main";

  // Check for an existing open PR for this head/base pair
  try {
    const existingResponse = await fetchWithRetry(
      `https://api.github.com/repos/${owner}/${repo}/pulls?head=${owner}:${options.branch}&base=${base}&state=open`,
      {
        headers: {
          Authorization: `Bearer ${options.githubToken}`,
          Accept: "application/vnd.github+json",
        },
      },
    );

    const existing = (await existingResponse.json()) as { html_url: string; number: number }[];
    if (existing.length > 0) {
      logger.info({ url: existing[0].html_url, prNumber: existing[0].number, branch: options.branch }, "PR already exists, skipping creation");
      return { url: existing[0].html_url, number: existing[0].number };
    }
  } catch {
    // If checking existing PRs fails, proceed to create a new one
  }

  const response = await fetchWithRetry(
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.githubToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: options.title,
        body: options.body,
        head: options.branch,
        base,
      }),
    },
    { retryableStatuses: [429, 500, 502, 503, 504] },
  );

  const data = (await response.json()) as { html_url: string; number: number };

  // Add labels if specified
  if (options.labels?.length) {
    try {
      await fetchWithRetry(
        `https://api.github.com/repos/${owner}/${repo}/issues/${data.number}/labels`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.githubToken}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ labels: options.labels }),
        },
      );
    } catch (err) {
      logger.warn({ err }, "Failed to add labels to PR");
    }
  }

  // Add reviewers if specified
  if (options.reviewers?.length) {
    try {
      await fetchWithRetry(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${data.number}/requested_reviewers`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.githubToken}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ reviewers: options.reviewers }),
        },
      );
    } catch (err) {
      logger.warn({ err }, "Failed to add reviewers to PR");
    }
  }

  logger.info({ url: data.html_url, prNumber: data.number, branch: options.branch }, "Created PR");
  return { url: data.html_url, number: data.number };
}

export async function replyToPRComment(
  repo: string,
  prNumber: number,
  body: string,
  githubToken: string,
): Promise<void> {
  const { owner, repo: repoName } = parseOwnerRepo(repo);

  await fetchWithRetry(
    `https://api.github.com/repos/${owner}/${repoName}/issues/${prNumber}/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    },
  );
}

export async function getChangeSummary(
  worktreePath: string,
): Promise<{ stats: string; commitMessage: string }> {
  const git = simpleGit(worktreePath);

  const log = await git.log({ maxCount: 1 });
  const commitMessage = log.latest?.message ?? "";

  const diff = await git.diff(["--stat", "HEAD~1", "HEAD"]);
  const lines = diff.trim().split("\n");
  const stats = lines[lines.length - 1]?.trim() ?? "";

  return { stats, commitMessage };
}

export async function pullBranch(
  worktreePath: string,
  branch: string,
): Promise<void> {
  const git = simpleGit(worktreePath);
  await git.pull("origin", branch);
}
