import simpleGit from "simple-git";
import { spawnAsync } from "../utils/process";
import { logger } from "../utils/logger";

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
  title: string;
  body: string;
  labels?: string[];
  reviewers?: string[];
}

export interface PRResult {
  url: string;
  number: number;
}

export async function createPR(
  worktreePath: string,
  options: PROptions,
): Promise<PRResult> {
  const args = [
    "pr",
    "create",
    "--title",
    options.title,
    "--body",
    options.body,
    "--head",
    options.branch,
  ];

  if (options.labels?.length) {
    for (const label of options.labels) {
      args.push("--label", label);
    }
  }

  if (options.reviewers?.length) {
    for (const reviewer of options.reviewers) {
      args.push("--reviewer", reviewer);
    }
  }

  const result = await spawnAsync("gh", args, { cwd: worktreePath });

  if (result.exitCode !== 0) {
    throw new Error(`Failed to create PR: ${result.stderr}`);
  }

  const url = result.stdout.trim();
  const prNumber = parseInt(url.split("/").pop() ?? "0", 10);

  logger.info({ url, prNumber, branch: options.branch }, "Created PR");
  return { url, number: prNumber };
}

export async function replyToPRComment(
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  await spawnAsync("gh", [
    "pr",
    "comment",
    String(prNumber),
    "--repo",
    repo,
    "--body",
    body,
  ]);
}

export async function pullBranch(
  worktreePath: string,
  branch: string,
): Promise<void> {
  const git = simpleGit(worktreePath);
  await git.pull("origin", branch);
}
