import { type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { resolveAgent } from "../agents/resolve-agent";
import { createWorktree, ensureRepoClone, type WorktreeInfo } from "./worktree";
import { commitAll, pushBranch, createPR, amendAndForcePush, pullBranch } from "./git";
import { initHistory, addFeedbackRound, buildFeedbackPrompt, loadHistory } from "./feedback";
import { notify, type TaskEvent } from "./notify";
import { postTaskComments, postVerificationFailureComment } from "./comments";
import { recordTaskCost } from "./cost";
import { recordEvent } from "./events";
import { spawnAgentAndWait, runVerificationCommands, buildVerificationFixPrompt } from "./verify";
import { logger } from "../utils/logger";
import type { Task } from "./queue";
import type { GlobalConfig, ProjectConfig } from "../config/schema";

export interface RunnerConfig {
  maxConcurrent: number;
  globalConfig: GlobalConfig;
}

interface ActiveTask {
  task: Task;
  process: ChildProcess | null;
  worktree: WorktreeInfo;
  startTime: number;
}

export class TaskRunner extends EventEmitter {
  private active = new Map<string, ActiveTask>();
  private maxConcurrent: number;
  private globalConfig: GlobalConfig;

  constructor(config: RunnerConfig) {
    super();
    this.maxConcurrent = config.maxConcurrent;
    this.globalConfig = config.globalConfig;
  }

  async run(
    task: Task,
    projectConfig: ProjectConfig,
  ): Promise<boolean> {
    if (this.active.size >= this.maxConcurrent) return false;

    const projectName = task.project;
    const { payload } = task;
    const startTime = Date.now();

    logger.info(
      { taskId: task.id, project: projectName, type: task.type },
      "Starting task",
    );

    try {
      // Ensure repo is cloned before creating worktrees
      await ensureRepoClone(projectName, projectConfig.repo, projectConfig.branch);

      // Create or reuse worktree
      const worktree = await createWorktree(
        projectName,
        payload.taskId,
        payload.title,
        projectConfig.branch,
      );

      // Build prompt
      let prompt: string;

      if (task.type === "feedback") {
        // Pull latest changes
        await pullBranch(worktree.path, worktree.branch);

        // Add feedback to history and build prompt
        const history =
          loadHistory(worktree.path) ??
          initHistory(worktree.path, payload.taskId, payload.description);
        addFeedbackRound(worktree.path, payload.comment ?? "");
        prompt = buildFeedbackPrompt(
          history,
          payload.comment ?? "",
        );
      } else {
        // Initialize feedback history for new tasks
        initHistory(worktree.path, payload.taskId, payload.description);

        // Build initial prompt
        const contextParts: string[] = [];
        if (projectConfig.claude?.systemContext) {
          contextParts.push(projectConfig.claude.systemContext);
        }
        contextParts.push(
          `Task: ${payload.title}\n\n${payload.description}`,
        );
        prompt = contextParts.join("\n\n");
      }

      // Resolve agent
      const agent = resolveAgent(projectConfig.agent);
      const allowedTools = projectConfig.agentTools?.[projectConfig.agent]
        ?? projectConfig.claude?.allowedTools;

      const agentOptions = {
        instructions: projectConfig.claude?.instructions,
        allowedTools,
        maxCostPerTask: projectConfig.claude?.maxCostPerTask,
      };

      const agentCmd = agent.buildCommand(prompt, worktree.path, agentOptions);

      logger.info(
        {
          taskId: task.id,
          command: agentCmd.command,
          args: agentCmd.args,
          cwd: worktree.path,
        },
        "Executing agent command",
      );

      const agentEnv: Record<string, string | undefined> = {
        ...(projectConfig.anthropicApiKey && { ANTHROPIC_API_KEY: projectConfig.anthropicApiKey }),
        ...(projectConfig.openaiApiKey && { OPENAI_API_KEY: projectConfig.openaiApiKey }),
        ...(projectConfig.openrouterApiKey && { OPENROUTER_API_KEY: projectConfig.openrouterApiKey }),
        ...(projectConfig.githubToken && { GITHUB_TOKEN: projectConfig.githubToken }),
        ...agentCmd.env,
      };

      const activeTask: ActiveTask = {
        task,
        process: null,
        worktree,
        startTime,
      };
      this.active.set(task.id, activeTask);

      this.emit("taskStarted", task);

      recordEvent({
        timestamp: new Date().toISOString(),
        type: "taskStarted",
        taskId: payload.taskId,
        project: projectName,
        title: payload.title,
      });

      // Run agent (async, non-blocking for the caller)
      this.executeTask(
        task, projectConfig, projectName, worktree, agentCmd, agentEnv,
        agentOptions, agent, startTime,
      ).catch((err) => {
        logger.error({ taskId: task.id, err }, "Unhandled error in task execution");
      });

      return true;
    } catch (err) {
      logger.error({ taskId: task.id, err }, "Failed to start task");

      const event: TaskEvent = {
        type: "taskFailed",
        taskId: payload.taskId,
        title: payload.title,
        project: projectName,
        error: String(err),
        duration: Math.floor((Date.now() - startTime) / 1000),
      };
      await notify(event, this.globalConfig, projectConfig);

      this.emit("taskFailed", task, err);
      return false;
    }
  }

  private async executeTask(
    task: Task,
    projectConfig: ProjectConfig,
    projectName: string,
    worktree: WorktreeInfo,
    agentCmd: ReturnType<ReturnType<typeof resolveAgent>["buildCommand"]>,
    agentEnv: Record<string, string | undefined>,
    agentOptions: {
      instructions?: string;
      allowedTools?: string[];
      maxCostPerTask?: number;
    },
    agent: ReturnType<typeof resolveAgent>,
    startTime: number,
  ): Promise<void> {
    const { payload } = task;

    // Spawn initial agent
    const result = await spawnAgentAndWait(agentCmd, worktree.path, agentEnv);
    this.active.delete(task.id);
    const duration = Math.floor((Date.now() - startTime) / 1000);

    if (result.exitCode === 0) {
      try {
        if (task.type === "feedback") {
          await amendAndForcePush(worktree.path, worktree.branch);
        } else {
          // Run verification commands for new tasks
          const verifyConfig = projectConfig.verification;
          const commands = verifyConfig?.commands ?? [];

          if (commands.length > 0) {
            const maxRetries = verifyConfig?.maxRetries ?? 3;
            let retriesUsed = 0;
            let verified = false;

            while (retriesUsed <= maxRetries) {
              const verifyResult = await runVerificationCommands(
                worktree.path, commands, agentEnv,
              );

              if (verifyResult.success) {
                verified = true;
                break;
              }

              if (retriesUsed >= maxRetries) {
                logger.error({
                  taskId: task.id,
                  failedCommand: verifyResult.failedCommand,
                  retries: retriesUsed,
                }, "Verification failed after max retries");

                const event: TaskEvent = {
                  type: "taskFailed",
                  taskId: payload.taskId,
                  title: payload.title,
                  project: projectName,
                  error: `Verification command "${verifyResult.failedCommand}" failed after ${retriesUsed} retries.\n\nOutput:\n${verifyResult.output?.slice(-1000)}`,
                  duration,
                };
                await notify(event, this.globalConfig, projectConfig);

                await postVerificationFailureComment({
                  task,
                  projectConfig,
                  failedCommand: verifyResult.failedCommand!,
                  output: verifyResult.output ?? "",
                  retries: retriesUsed,
                });

                recordTaskCost(payload.taskId, 0, duration, false, true, {
                  project: projectName,
                  title: payload.title,
                  error: `Verification failed: ${verifyResult.failedCommand}`,
                });

                recordEvent({
                  timestamp: new Date().toISOString(),
                  type: "taskFailed",
                  taskId: payload.taskId,
                  project: projectName,
                  title: payload.title,
                  duration,
                  error: `Verification failed: ${verifyResult.failedCommand}`,
                });

                this.emit("taskFailed", task, new Error("Verification failed"));
                return;
              }

              // Re-invoke the agent with the error
              retriesUsed++;
              logger.info({
                taskId: task.id,
                retry: retriesUsed,
                maxRetries,
                failedCommand: verifyResult.failedCommand,
              }, "Re-invoking agent to fix verification failure");

              const fixPrompt = buildVerificationFixPrompt(
                verifyResult.failedCommand!,
                verifyResult.output ?? "",
                retriesUsed,
                maxRetries,
              );

              const fixCmd = agent.buildCommand(fixPrompt, worktree.path, agentOptions);
              const fixResult = await spawnAgentAndWait(fixCmd, worktree.path, agentEnv);

              if (fixResult.exitCode !== 0) {
                logger.warn({
                  taskId: task.id,
                  exitCode: fixResult.exitCode,
                  retry: retriesUsed,
                }, "Fix agent exited with non-zero code");
              }
            }

            if (!verified) return;
          }

          // Proceed with commit → push → PR flow
          const commitMsg = `feat: ${payload.title} [${payload.taskId}]`;
          await commitAll(worktree.path, commitMsg);
          await pushBranch(worktree.path, worktree.branch);

          const prConfig = projectConfig.pr;
          const prTitle = (prConfig?.titleFormat ?? "feat: {taskTitle} [{taskId}]")
            .replace("{taskTitle}", payload.title)
            .replace("{taskId}", payload.taskId);

          const prBody = (prConfig?.bodyTemplate ?? "Resolves {taskId}")
            .replace("{taskTitle}", payload.title)
            .replace("{taskId}", payload.taskId);

          const pr = await createPR(worktree.path, {
            repo: projectConfig.repo,
            branch: worktree.branch,
            baseBranch: projectConfig.branch,
            title: prTitle,
            body: prBody,
            labels: prConfig?.labels,
            reviewers: prConfig?.reviewers,
            githubToken: projectConfig.githubToken ?? "",
          });

          recordTaskCost(payload.taskId, 0, duration, true, false, {
            project: projectName,
            title: payload.title,
            prUrl: pr.url,
          });

          recordEvent({
            timestamp: new Date().toISOString(),
            type: "prCreated",
            taskId: payload.taskId,
            project: projectName,
            title: payload.title,
            duration,
            prUrl: pr.url,
          });

          const event: TaskEvent = {
            type: "prCreated",
            taskId: payload.taskId,
            title: payload.title,
            project: projectName,
            prUrl: pr.url,
            duration,
          };
          await notify(event, this.globalConfig, projectConfig);

          await postTaskComments({
            worktreePath: worktree.path,
            repo: projectConfig.repo,
            prUrl: pr.url,
            prNumber: pr.number,
            taskTitle: payload.title,
            taskId: payload.taskId,
            projectConfig,
            task,
          });
        }

        this.emit("taskCompleted", task);
        logger.info(
          { taskId: task.id, duration },
          "Task completed successfully",
        );
      } catch (err) {
        this.emit("taskFailed", task, err);
        logger.error(
          { taskId: task.id, err, stderr: result.stderr.slice(-2000), stdout: result.stdout.slice(-2000) },
          "Post-agent steps failed",
        );
        recordTaskCost(payload.taskId, 0, duration, false, true, {
          project: projectName,
          title: payload.title,
          error: String(err),
        });

        recordEvent({
          timestamp: new Date().toISOString(),
          type: "taskFailed",
          taskId: payload.taskId,
          project: projectName,
          title: payload.title,
          duration,
          error: String(err),
        });

        const event: TaskEvent = {
          type: "taskFailed",
          taskId: payload.taskId,
          title: payload.title,
          project: projectName,
          error: String(err),
          duration,
        };
        await notify(event, this.globalConfig, projectConfig);
      }
    } else {
      const lastStderrSnippet = result.stderr.slice(-2000);
      const lastStdoutSnippet = result.stdout.slice(-2000);
      const errorDetail = lastStderrSnippet || lastStdoutSnippet || "No output captured";

      recordTaskCost(payload.taskId, 0, duration, false, true, {
        project: projectName,
        title: payload.title,
        error: `Agent exited with code ${result.exitCode}: ${errorDetail.slice(0, 500)}`,
      });

      recordEvent({
        timestamp: new Date().toISOString(),
        type: "taskFailed",
        taskId: payload.taskId,
        project: projectName,
        title: payload.title,
        duration,
        error: `Agent exited with code ${result.exitCode}: ${errorDetail.slice(0, 500)}`,
      });

      const errorJson = JSON.stringify(
        { exitCode: result.exitCode, detail: errorDetail.slice(0, 500) },
        null,
        2,
      );

      const event: TaskEvent = {
        type: "taskFailed",
        taskId: payload.taskId,
        title: payload.title,
        project: projectName,
        error: errorJson,
        duration,
      };
      await notify(event, this.globalConfig, projectConfig);
      this.emit("taskFailed", task, new Error(`Exit code: ${result.exitCode}`));
      logger.error(
        { taskId: task.id, exitCode: result.exitCode, duration, stderr: lastStderrSnippet, stdout: lastStdoutSnippet },
        "Task failed",
      );
    }
  }

  isActive(taskId: string): boolean {
    return this.active.has(taskId);
  }

  cancelTask(taskId: string): boolean {
    const active = this.active.get(taskId);
    if (!active) return false;

    active.process?.kill("SIGTERM");
    this.active.delete(taskId);
    return true;
  }

  get activeTasks(): Array<{ taskId: string; project: string; startTime: number }> {
    return Array.from(this.active.values()).map((a) => ({
      taskId: a.task.id,
      project: a.task.project,
      startTime: a.startTime,
    }));
  }

  get availableSlots(): number {
    return this.maxConcurrent - this.active.size;
  }

  get activeCount(): number {
    return this.active.size;
  }

  async waitForAll(timeoutMs: number = 300_000): Promise<void> {
    if (this.active.size === 0) return;

    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (this.active.size === 0) {
          clearInterval(check);
          clearTimeout(timer);
          resolve();
        }
      }, 1000);

      const timer = setTimeout(() => {
        clearInterval(check);
        // Force kill remaining
        for (const [id, active] of this.active) {
          active.process?.kill("SIGKILL");
          this.active.delete(id);
        }
        resolve();
      }, timeoutMs);
    });
  }
}
