import { resolveAgent } from "../agents/resolve-agent";
import { postVerificationFailureComment } from "./comments";
import { TaskLifecycle, type TaskContext } from "./task-lifecycle";
import { spawnAgentAndWait, runVerificationCommands, buildVerificationFixPrompt } from "./verify";
import { logger } from "../utils/logger";
import type { Task } from "./queue";
import type { ProjectConfig } from "../config/schema";
import type { WorktreeInfo } from "./worktree";

interface ActiveTaskRef {
  process: import("node:child_process").ChildProcess | null;
}

export class VerificationRunner {
  private lifecycle: TaskLifecycle;

  constructor(lifecycle: TaskLifecycle) {
    this.lifecycle = lifecycle;
  }

  /**
   * Run verification commands in a loop, re-invoking the agent to fix failures.
   * Returns true if verification passes, false if it fails after all retries.
   */
  async runVerificationLoop(
    task: Task,
    projectConfig: ProjectConfig,
    projectName: string,
    worktree: WorktreeInfo,
    agentEnv: Record<string, string | undefined>,
    agentOptions: {
      instructions?: string;
      allowedTools?: string[];
      maxCostPerTask?: number;
      model?: string;
    },
    agent: ReturnType<typeof resolveAgent>,
    duration: number,
    commands: string[],
    maxRetries: number,
    getActiveTask: () => ActiveTaskRef | undefined,
    commandTimeoutMs?: number,
  ): Promise<boolean> {
    const { payload } = task;
    const ctx: TaskContext = { taskId: payload.taskId, title: payload.title, project: projectName };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const verifyResult = await runVerificationCommands(worktree.path, commands, agentEnv, commandTimeoutMs);

      if (verifyResult.success) return true;

      if (attempt === maxRetries) {
        logger.error(
          { taskId: task.id, failedCommand: verifyResult.failedCommand, retries: attempt },
          "Verification failed after max retries",
        );

        await this.lifecycle.recordFailure(ctx, duration, `Verification failed: ${verifyResult.failedCommand}`, projectConfig);

        await postVerificationFailureComment({
          task,
          projectConfig,
          failedCommand: verifyResult.failedCommand!,
          output: verifyResult.output ?? "",
          retries: attempt,
        });

        return false;
      }

      // Re-invoke agent to fix
      logger.info(
        { taskId: task.id, retry: attempt + 1, maxRetries, failedCommand: verifyResult.failedCommand },
        "Re-invoking agent to fix verification failure",
      );

      const fixPrompt = buildVerificationFixPrompt(
        verifyResult.failedCommand!,
        verifyResult.output ?? "",
        attempt + 1,
        maxRetries,
      );

      const fixCmd = agent.buildCommand(fixPrompt, worktree.path, agentOptions);
      const fixHandle = spawnAgentAndWait(fixCmd, worktree.path, agentEnv);
      const fixActiveEntry = getActiveTask();
      if (fixActiveEntry) {
        fixActiveEntry.process = fixHandle.process;
      } else {
        // Task was cancelled during verification fix — kill immediately
        fixHandle.process.kill("SIGTERM");
        return false;
      }
      const fixResult = await fixHandle.result;

      if (fixResult.exitCode !== 0) {
        logger.warn(
          { taskId: task.id, exitCode: fixResult.exitCode, retry: attempt + 1 },
          "Fix agent exited with non-zero code",
        );
      }
    }

    return false;
  }
}
