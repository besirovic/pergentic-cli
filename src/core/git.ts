import simpleGit from "simple-git";
import { z } from "zod";
import { logger } from "../utils/logger";
import { fetchWithRetry } from "../utils/http";
import { PR_BODY_OUTPUT_FILE } from "./pr-template";

const GitHubPRSchema = z.object({
  html_url: z.string(),
  number: z.number(),
});
const GitHubPRListSchema = z.array(GitHubPRSchema);
const GitHubCommentSchema = z.object({
  id: z.number(),
});

export function parseOwnerRepo(repo: string): { owner: string; repo: string; hostname: string } {
  // Handle SSH: git@<any-host>:owner/repo.git
  const sshMatch = repo.match(/^git@([^:]+):([^/]+)\/([^/.]+)/);
  if (sshMatch) return { owner: sshMatch[2], repo: sshMatch[3], hostname: sshMatch[1] };

  // Handle HTTPS using URL class (supports github.com and GitHub Enterprise)
  try {
    const url = new URL(repo);
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2) {
      throw new Error(`Cannot parse owner/repo from path: ${url.pathname}`);
    }
    const repoName = segments[1].replace(/\.git$/, "");
    return { owner: segments[0], repo: repoName, hostname: url.hostname };
  } catch (err) {
    if (err instanceof TypeError) {
      // Not a valid URL — fall through
    } else {
      throw err;
    }
  }

  throw new Error(`Cannot parse owner/repo from: ${repo}`);
}

/** Captures current branch and last commit hash for error context. Never throws. */
async function getGitContext(worktreePath: string): Promise<{ branch: string; lastCommit: string }> {
  try {
    const git = simpleGit(worktreePath);
    const [branch, log] = await Promise.all([
      git.revparse(["--abbrev-ref", "HEAD"]),
      git.log({ maxCount: 1 }),
    ]);
    return { branch: branch.trim(), lastCommit: log.latest?.hash ?? "unknown" };
  } catch {
    return { branch: "unknown", lastCommit: "unknown" };
  }
}

/**
 * Stages all tracked files (excluding .claude-history.json and pr-body) and commits.
 * Fatal: merge conflicts, nothing to commit, locked index.
 */
export async function commitAll(
  worktreePath: string,
  message: string,
): Promise<void> {
  const git = simpleGit(worktreePath);
  try {
    await git.add([".", ":!.claude-history.json", `:!${PR_BODY_OUTPUT_FILE}`]);
    await git.commit(message);
    logger.info({ worktreePath, message }, "Committed changes");
  } catch (err) {
    const ctx = await getGitContext(worktreePath);
    logger.error({ err, worktreePath, message, ...ctx }, "Git commit failed");
    throw new Error(
      `Git commit failed on branch '${ctx.branch}' (last commit: ${ctx.lastCommit}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Pushes a branch to origin.
 * Recoverable: transient network errors (caller may retry).
 * Fatal: push rejected (non-fast-forward without force).
 */
export async function pushBranch(
  worktreePath: string,
  branch: string,
): Promise<void> {
  const git = simpleGit(worktreePath);
  try {
    await git.push("origin", branch);
    logger.info({ worktreePath, branch }, "Pushed branch");
  } catch (err) {
    const ctx = await getGitContext(worktreePath);
    logger.error({ err, worktreePath, branch, ...ctx }, "Git push failed");
    throw new Error(
      `Git push of '${branch}' failed on branch '${ctx.branch}' (last commit: ${ctx.lastCommit}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Amends the last commit with all staged changes and force-pushes.
 * Fatal: no previous commit to amend, push rejected without proper force authorization.
 */
export async function amendAndForcePush(
  worktreePath: string,
  branch: string,
): Promise<void> {
  const git = simpleGit(worktreePath);
  try {
    await git.add("-A");
    await git.commit("", { "--amend": null, "--no-edit": null });
    await git.push("origin", branch, ["--force"]);
    logger.info({ worktreePath, branch }, "Amended and force-pushed");
  } catch (err) {
    const ctx = await getGitContext(worktreePath);
    logger.error({ err, worktreePath, branch, ...ctx }, "Git amend and force-push failed");
    throw new Error(
      `Git amend/force-push of '${branch}' failed on branch '${ctx.branch}' (last commit: ${ctx.lastCommit}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
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
  warnings?: string[];
}

export async function createPR(
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

    const parsed = GitHubPRListSchema.safeParse(await existingResponse.json());
    if (parsed.success && parsed.data.length > 0) {
      const pr = parsed.data[0];
      logger.info({ url: pr.html_url, prNumber: pr.number, branch: options.branch }, "PR already exists, skipping creation");
      return { url: pr.html_url, number: pr.number };
    }
  } catch (err) {
    logger.warn({ err, branch: options.branch }, "Failed to check for existing PRs, proceeding to create");
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

  const prParsed = GitHubPRSchema.safeParse(await response.json());
  if (!prParsed.success) {
    throw new Error(`Unexpected GitHub API response when creating PR: ${prParsed.error.message}`);
  }
  const prData = prParsed.data;

  const warnings: string[] = [];

  // Add labels if specified
  if (options.labels?.length) {
    const labelsUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${prData.number}/labels`;
    try {
      await fetchWithRetry(labelsUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.githubToken}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ labels: options.labels }),
      }, { maxRetries: 5 });
    } catch (err) {
      const msg = `Failed to add labels [${options.labels.join(", ")}] to PR #${prData.number}. Add manually at ${prData.html_url}`;
      logger.warn({ err, labels: options.labels, prNumber: prData.number }, msg);
      warnings.push(msg);
    }
  }

  // Add reviewers if specified
  if (options.reviewers?.length) {
    const reviewersUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prData.number}/requested_reviewers`;
    try {
      await fetchWithRetry(reviewersUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.githubToken}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reviewers: options.reviewers }),
      }, { maxRetries: 5 });
    } catch (err) {
      const msg = `Failed to add reviewers [${options.reviewers.join(", ")}] to PR #${prData.number}. Add manually at ${prData.html_url}`;
      logger.warn({ err, reviewers: options.reviewers, prNumber: prData.number }, msg);
      warnings.push(msg);
    }
  }

  logger.info({ url: prData.html_url, prNumber: prData.number, branch: options.branch }, "Created PR");
  return { url: prData.html_url, number: prData.number, ...(warnings.length > 0 && { warnings }) };
}

export async function replyToPRComment(
  repo: string,
  prNumber: number,
  body: string,
  githubToken: string,
): Promise<void> {
  const { owner, repo: repoName } = parseOwnerRepo(repo);

  const response = await fetchWithRetry(
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

  const data = await response.json();
  const result = GitHubCommentSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`Unexpected GitHub API response when creating comment: ${JSON.stringify(data)}`);
  }
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

/**
 * Pulls a branch from origin.
 * Recoverable: transient network errors (caller may retry).
 * Fatal: merge conflict on pull.
 */
export async function pullBranch(
  worktreePath: string,
  branch: string,
): Promise<void> {
  const git = simpleGit(worktreePath);
  try {
    await git.pull("origin", branch);
  } catch (err) {
    const ctx = await getGitContext(worktreePath);
    logger.error({ err, worktreePath, branch, ...ctx }, "Git pull failed");
    throw new Error(
      `Git pull of '${branch}' failed on branch '${ctx.branch}' (last commit: ${ctx.lastCommit}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
