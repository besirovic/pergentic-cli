import simpleGit from "simple-git";
import { TaskLifecycle, type TaskContext } from "./task-lifecycle";
import { PRCreationService } from "./pr-service";
import { execCommand } from "./verify";
import { logger } from "../utils/logger";
import type { Task } from "./queue";
import type { ProjectConfig } from "../config/schema";
import type { WorktreeInfo } from "./worktree";

export class ScheduledCommandRunner {
  private lifecycle: TaskLifecycle;
  private prService: PRCreationService;

  constructor(lifecycle: TaskLifecycle, prService: PRCreationService) {
    this.lifecycle = lifecycle;
    this.prService = prService;
  }

  /**
   * Execute a scheduled shell command in the worktree.
   * If the command produces changes, create a PR.
   */
  async execute(
    task: Task,
    projectConfig: ProjectConfig,
    projectName: string,
    worktree: WorktreeInfo,
    command: string,
    startTime: number,
  ): Promise<{ success: boolean; prUrl?: string }> {
    const { payload } = task;
    const ctx: TaskContext = { taskId: payload.taskId, title: payload.title, project: projectName };
    const agentEnv: Record<string, string | undefined> = {
      ...(projectConfig.githubToken && { GITHUB_TOKEN: projectConfig.githubToken }),
    };

    const result = await execCommand(command, worktree.path, agentEnv);
    const duration = Math.floor((Date.now() - startTime) / 1000);

    if (!result.success) {
      await this.lifecycle.recordFailure(ctx, duration, `Command failed: ${result.output.slice(-1000)}`, projectConfig);
      return { success: false };
    }

    // Check for changes
    const git = simpleGit(worktree.path);
    const status = await git.status();

    if (status.files.length === 0) {
      logger.info({ taskId: task.id }, "Scheduled command produced no changes, skipping PR");
      return { success: true };
    }

    // Commit, push, create PR
    const pr = await this.prService.createPRFromWorktree(task, projectConfig, worktree);
    await this.lifecycle.recordSuccess(ctx, duration, pr.url, projectConfig);

    logger.info({ taskId: task.id, duration, prUrl: pr.url }, "Scheduled command task completed");
    return { success: true, prUrl: pr.url };
  }
}
