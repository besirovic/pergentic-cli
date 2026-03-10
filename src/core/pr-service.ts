import { commitAll, pushBranch, createPR } from "./git";
import { postTaskComments } from "./comments";
import { buildPRDetails } from "./pr-builder";
import { readAgentPRBody } from "./pr-template";
import type { Task } from "./queue";
import type { ProjectConfig } from "../config/schema";
import type { WorktreeInfo } from "./worktree";

export interface PRResult {
  url: string;
  number: number;
}

export class PRCreationService {
  /**
   * Commit changes, push the branch, create a PR, and post comments.
   * Returns the PR URL and number.
   */
  async createPRFromWorktree(
    task: Task,
    projectConfig: ProjectConfig,
    worktree: WorktreeInfo,
  ): Promise<PRResult> {
    const agentBody = await readAgentPRBody(worktree.path);
    const prDetails = buildPRDetails(task, projectConfig, agentBody);
    await commitAll(worktree.path, prDetails.commitMessage);
    await pushBranch(worktree.path, worktree.branch);

    const pr = await createPR(worktree.path, {
      repo: projectConfig.repo,
      branch: worktree.branch,
      baseBranch: projectConfig.branch,
      title: prDetails.title,
      body: prDetails.body,
      labels: projectConfig.pr?.labels,
      reviewers: projectConfig.pr?.reviewers,
      githubToken: projectConfig.githubToken ?? "",
    });

    await postTaskComments({
      worktreePath: worktree.path,
      repo: projectConfig.repo,
      prUrl: pr.url,
      prNumber: pr.number,
      taskTitle: task.payload.title,
      taskId: task.payload.taskId,
      projectConfig,
      task,
    });

    return pr;
  }
}
