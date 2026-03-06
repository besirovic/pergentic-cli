import simpleGit from "simple-git";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { worktreesDir, repoDir } from "../config/paths";
import { logger } from "../utils/logger";

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
  const git = simpleGit();
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
): Promise<WorktreeInfo> {
  const repo = repoDir(projectName);
  const worktrees = worktreesDir(projectName);

  if (!existsSync(worktrees)) mkdirSync(worktrees, { recursive: true });

  const branchName = `${taskId}-${slugify(taskTitle)}`;
  const worktreePath = join(worktrees, taskId);

  if (existsSync(worktreePath)) {
    logger.info({ taskId, path: worktreePath }, "Worktree already exists, reusing");
    return { path: worktreePath, branch: branchName, taskId };
  }

  const git = simpleGit(repo);

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
  const git = simpleGit(repo);

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

