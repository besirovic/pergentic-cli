import simpleGit from "simple-git";
import { existsSync, mkdirSync, readdirSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { worktreesDir, repoDir } from "../config/paths";
import { logger } from "../utils/logger";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
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

export async function listWorktrees(
  projectName: string,
): Promise<WorktreeInfo[]> {
  const repo = repoDir(projectName);
  if (!existsSync(repo)) return [];

  const git = simpleGit(repo);
  const result = await git.raw(["worktree", "list", "--porcelain"]);

  const worktrees: WorktreeInfo[] = [];
  const blocks = result.split("\n\n").filter(Boolean);

  for (const block of blocks) {
    const lines = block.split("\n");
    const pathLine = lines.find((l) => l.startsWith("worktree "));
    const branchLine = lines.find((l) => l.startsWith("branch "));

    if (pathLine && branchLine) {
      const path = pathLine.replace("worktree ", "");
      const branch = branchLine.replace("branch refs/heads/", "");
      // Extract taskId from path (last segment)
      const taskId = path.split("/").pop() ?? "";
      if (taskId && path !== repo) {
        worktrees.push({ path, branch, taskId });
      }
    }
  }

  return worktrees;
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

export async function cleanupStaleWorktrees(
  projectName: string,
  maxAgeDays: number = 7,
): Promise<string[]> {
  const dir = worktreesDir(projectName);
  if (!existsSync(dir)) return [];

  const now = Date.now();
  const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
  const cleaned: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    try {
      const stat = statSync(full);
      if (now - stat.mtimeMs > maxAge) {
        await removeWorktree(projectName, full);
        cleaned.push(entry);
      }
    } catch {
      // Skip entries we can't stat
    }
  }

  return cleaned;
}
