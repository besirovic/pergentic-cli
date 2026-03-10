import simpleGit, { type SimpleGitOptions } from "simple-git";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { worktreesDir, repoDir } from "../config/paths";
import { logger } from "../utils/logger";

const GIT_TIMEOUT_MS = 60_000;

const gitOpts: Partial<SimpleGitOptions> = {
  timeout: { block: GIT_TIMEOUT_MS },
};

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  if (slug.length <= 50) return slug;

  // Add hash suffix to prevent collisions when truncating
  const hash = createHash("md5").update(text).digest("hex").slice(0, 7);
  return `${slug.slice(0, 42)}-${hash}`;
}

export async function ensureRepoClone(
  projectName: string,
  remoteUrl: string,
  baseBranch: string,
): Promise<string> {
  const repo = repoDir(projectName);

  if (existsSync(join(repo, ".git")) || existsSync(join(repo, "HEAD"))) {
    return repo;
  }

  const parentDir = dirname(repo);
  if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });

  logger.info({ projectName, repo, remoteUrl }, "Cloning repo for worktree use");
  const git = simpleGit({ ...gitOpts });
  await git.clone(remoteUrl, repo, ["--branch", baseBranch]);

  return repo;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  taskId: string;
}

export async function createWorktree(
  projectName: string,
  taskId: string,
  taskTitle: string,
  baseBranch: string,
  branchNameOverride?: string,
): Promise<WorktreeInfo> {
  const repo = repoDir(projectName);
  const worktrees = worktreesDir(projectName);

  if (!existsSync(worktrees)) mkdirSync(worktrees, { recursive: true });

  const branchName = branchNameOverride ?? `${taskId}-${slugify(taskTitle)}`;
  const worktreePath = join(worktrees, taskId);

  if (existsSync(worktreePath)) {
    // Read actual branch from existing worktree instead of assuming current template
    let existingBranch = branchName;
    try {
      const wtGit = simpleGit({ baseDir: worktreePath, ...gitOpts });
      const rev = await wtGit.revparse(["--abbrev-ref", "HEAD"]);
      if (rev.trim()) existingBranch = rev.trim();
    } catch {
      // Fall back to computed branch name
    }
    logger.info({ taskId, path: worktreePath, branch: existingBranch }, "Worktree already exists, reusing");
    return { path: worktreePath, branch: existingBranch, taskId };
  }

  const git = simpleGit({ baseDir: repo, ...gitOpts });

  // Pull latest from base branch
  try {
    await git.pull("origin", baseBranch);
  } catch (err) {
    logger.warn({ err }, "Failed to pull latest, continuing with local state");
  }

  // Create worktree
  await git.raw(["worktree", "add", "-b", branchName, worktreePath, baseBranch]);

  logger.info({ taskId, path: worktreePath, branch: branchName }, "Created worktree");
  return { path: worktreePath, branch: branchName, taskId };
}

export async function removeWorktree(
  projectName: string,
  worktreePath: string,
): Promise<void> {
  const repo = repoDir(projectName);
  const git = simpleGit({ baseDir: repo, ...gitOpts });

  try {
    await git.raw(["worktree", "remove", worktreePath, "--force"]);
    logger.info({ path: worktreePath }, "Removed worktree");
  } catch (err) {
    logger.warn({ err, path: worktreePath }, "Failed to remove worktree via git, cleaning manually");
    if (existsSync(worktreePath)) {
      rmSync(worktreePath, { recursive: true, force: true });
    }
    await git.raw(["worktree", "prune"]);
  }
}

