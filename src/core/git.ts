import simpleGit from "simple-git";
import { logger } from "../utils/logger";

function parseOwnerRepo(repo: string): { owner: string; repo: string } {
  // Handle HTTPS: https://github.com/owner/repo.git
  const httpsMatch = repo.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

  // Handle SSH: git@github.com:owner/repo.git
  const sshMatch = repo.match(/github\.com:([^/]+)\/([^/.]+)/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  throw new Error(`Cannot parse owner/repo from: ${repo}`);
}

export async function commitAll(
  worktreePath: string,
  message: string,
): Promise<void> {
  const git = simpleGit(worktreePath);
  await git.add("-A");
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

  const response = await fetch(
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
        base: options.baseBranch ?? "main",
      }),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to create PR (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as { html_url: string; number: number };

  // Add labels if specified
  if (options.labels?.length) {
    await fetch(
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
  }

  // Add reviewers if specified
  if (options.reviewers?.length) {
    await fetch(
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

  const response = await fetch(
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

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to comment on PR (${response.status}): ${errorBody}`);
  }
}

export async function pullBranch(
  worktreePath: string,
  branch: string,
): Promise<void> {
  const git = simpleGit(worktreePath);
  await git.pull("origin", branch);
}
