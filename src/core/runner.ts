import { type ChildProcess } from "node:child_process";
import { resolveAgent } from "../agents/resolve-agent";
import { createWorktree, ensureRepoClone, type WorktreeInfo } from "./worktree";
import { commitAll, pushBranch, createPR, amendAndForcePush, pullBranch } from "./git";
import { initHistory, addFeedbackRound, buildFeedbackPrompt, loadHistory } from "./feedback";
import { postTaskComments, postVerificationFailureComment } from "./comments";
import { spawnAgentAndWait, runVerificationCommands, buildVerificationFixPrompt, execCommand } from "./verify";
import { TaskLifecycle, type TaskContext } from "./task-lifecycle";
import { buildPRDetails } from "./pr-builder";
import { logger } from "../utils/logger";
import { TypedEventEmitter } from "../types/typed-emitter";
import type { Task } from "./queue";
import { AgentName } from "../config/schema";
import type { GlobalConfig, ProjectConfig } from "../config/schema";
import { buildBranchName, buildBranchTemplateVars, DEFAULT_BRANCH_TEMPLATE } from "./branch-name";
import { buildPromptFromTemplate } from "./prompt-template";
import { readAgentPRBody } from "./pr-template";
import type { SpawnResult } from "../utils/process";
import { cancellableSleep } from "../utils/sleep";
import simpleGit from "simple-git";

const MAX_ERROR_SNIPPET_CHARS = 2000;
const MAX_ERROR_DETAIL_CHARS = 500;
const SIGKILL_DELAY_MS = 10_000;

export interface TaskCompletedMeta {
  duration: number;
  projectConfig: ProjectConfig;
  prUrl?: string;
  prNumber?: number;
  worktreePath?: string;
}

export interface RunnerEvents {
  taskStarted: (task: Task) => void;
  taskCompleted: (task: Task, meta?: TaskCompletedMeta) => void;
  taskFailed: (task: Task, error: unknown) => void;
}

export interface RunnerConfig {
  maxConcurrent: number;
  globalConfig: GlobalConfig;
}

interface ActiveTask {
  task: Task;
  process: ChildProcess | null;
  worktree: WorktreeInfo;
  startTime: number;
  abortController: AbortController;
}

export class TaskRunner extends TypedEventEmitter<RunnerEvents> {
  private active = new Map<string, ActiveTask>();
  private maxConcurrent: number;
  private globalConfig: GlobalConfig;
  private lifecycle: TaskLifecycle;

  constructor(config: RunnerConfig) {
    super();
    this.maxConcurrent = config.maxConcurrent;
    this.globalConfig = config.globalConfig;
    this.lifecycle = new TaskLifecycle(config.globalConfig);
  }

  async run(
    task: Task,
    projectConfig: ProjectConfig,
    projectPath: string,
  ): Promise<boolean> {
    if (this.active.size >= this.maxConcurrent) return false;

    const projectName = task.project;
    const { payload } = task;
    const startTime = Date.now();
    const ctx: TaskContext = { taskId: payload.taskId, title: payload.title, project: projectName };

    logger.info(
      { taskId: task.id, project: projectName, type: task.type },
      "Starting task",
    );

    try {
      await ensureRepoClone(projectName, projectConfig.repo, projectConfig.branch);

      const isStandingBranch = task.type === "scheduled"
        && "schedulePrBehavior" in payload
        && payload.schedulePrBehavior === "update"
        && "schedulePrBranch" in payload
        && !!payload.schedulePrBranch;

      const worktreeTaskId = isStandingBranch
          ? payload.schedulePrBranch!
          : payload.taskId;

      // Resolve branch name from template (skip for standing branches and default template)
      const rawAgentName = payload.targetAgents?.[0] ?? projectConfig.agent;
      const parsedAgent = AgentName.catch("claude-code").parse(rawAgentName);
      let resolvedBranchName: string | undefined;

      const branchTemplate = projectConfig.branching?.template;
      if (!isStandingBranch && branchTemplate && branchTemplate !== DEFAULT_BRANCH_TEMPLATE) {
        const vars = buildBranchTemplateVars(branchTemplate, {
          taskId: worktreeTaskId,
          title: payload.title,
          source: payload.source,
          taskType: task.type,
          project: projectName,
          agent: parsedAgent,
          labels: payload.labels ?? [],
          typeMap: projectConfig.branching?.typeMap,
        });
        resolvedBranchName = buildBranchName(branchTemplate, vars);
      }

      const worktree = await createWorktree(
        projectName,
        worktreeTaskId,
        payload.title,
        projectConfig.branch,
        resolvedBranchName,
      );

      // Build prompt
      let prompt: string;

      if (task.type === "feedback") {
        await pullBranch(worktree.path, worktree.branch);
        const history =
          (await loadHistory(worktree.path)) ??
          (await initHistory(worktree.path, payload.taskId, payload.description));
        const comment = "comment" in payload ? payload.comment ?? "" : "";
        await addFeedbackRound(worktree.path, comment);
        prompt = buildFeedbackPrompt(history, comment);
      } else if (task.type === "scheduled" && "scheduledCommand" in payload && payload.scheduledCommand) {
        return this.runScheduledCommand(task, projectConfig, projectName, worktree, startTime);
      } else if (task.type === "scheduled" && !("scheduledCommand" in payload && payload.scheduledCommand)) {
        prompt = payload.description;
      } else {
        await initHistory(worktree.path, payload.taskId, payload.description);
        prompt = await buildPromptFromTemplate({
          projectPath,
          task,
          projectName,
          projectConfig,
          agentName: parsedAgent,
          worktreePath: worktree.path,
        });
      }

      // Resolve agent
      const agent = resolveAgent(parsedAgent);
      const allowedTools = projectConfig.agentTools?.[parsedAgent]
        ?? projectConfig.claude?.allowedTools;

      const agentOptions = {
        instructions: projectConfig.claude?.instructions,
        allowedTools,
        maxCostPerTask: projectConfig.claude?.maxCostPerTask,
        model: payload.targetModel,
      };

      const agentCmd = agent.buildCommand(prompt, worktree.path, agentOptions);

      logger.info(
        { taskId: task.id, command: agentCmd.command, args: agentCmd.args, cwd: worktree.path },
        "Executing agent command",
      );

      const agentEnv: Record<string, string | undefined> = {
        ...(projectConfig.anthropicApiKey && { ANTHROPIC_API_KEY: projectConfig.anthropicApiKey }),
        ...(projectConfig.openaiApiKey && { OPENAI_API_KEY: projectConfig.openaiApiKey }),
        ...(projectConfig.openrouterApiKey && { OPENROUTER_API_KEY: projectConfig.openrouterApiKey }),
        ...(projectConfig.githubToken && { GITHUB_TOKEN: projectConfig.githubToken }),
        ...agentCmd.env,
      };

      const abortController = new AbortController();
      const activeTask: ActiveTask = { task, process: null, worktree, startTime, abortController };
      this.active.set(task.id, activeTask);

      this.emit("taskStarted", task);
      await this.lifecycle.recordStart(ctx);

      this.executeTask(
        task, projectConfig, projectName, worktree, agentCmd, agentEnv,
        agentOptions, agent, startTime,
      ).catch((err) => {
        logger.error({ taskId: task.id, err }, "Unhandled error in task execution");
      });

      return true;
    } catch (err) {
      logger.error({ taskId: task.id, err }, "Failed to start task");
      const duration = Math.floor((Date.now() - startTime) / 1000);
      await this.lifecycle.recordFailure(ctx, duration, String(err), projectConfig);
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
      model?: string;
    },
    agent: ReturnType<typeof resolveAgent>,
    startTime: number,
  ): Promise<void> {
    const { payload } = task;
    const ctx: TaskContext = { taskId: payload.taskId, title: payload.title, project: projectName };

    const timeoutMs = projectConfig.claude?.agentTimeout
      ? projectConfig.claude.agentTimeout * 1000
      : undefined;

    const agentRetryConfig = projectConfig.agentRetry;
    const maxAgentRetries = agentRetryConfig?.maxRetries ?? 0;
    const baseDelayMs = (agentRetryConfig?.baseDelaySeconds ?? 30) * 1000;
    const signal = this.active.get(task.id)?.abortController.signal;

    let result!: SpawnResult;
    let lastAttempt = 0;

    for (let attempt = 0; attempt <= maxAgentRetries; attempt++) {
      lastAttempt = attempt;
      // Backoff before retry (skip on first attempt)
      if (attempt > 0) {
        if (!this.active.has(task.id)) {
          logger.info({ taskId: task.id, attempt }, "Task cancelled during agent retry backoff, aborting");
          return;
        }

        const delayMs = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 1000;
        logger.info(
          { taskId: task.id, attempt, maxRetries: maxAgentRetries, delayMs: Math.round(delayMs) },
          "Retrying agent execution after failure",
        );
        await cancellableSleep(delayMs, signal);

        // Re-check cancellation after sleep (may have been aborted early)
        if (!this.active.has(task.id)) {
          logger.info({ taskId: task.id, attempt }, "Task cancelled during agent retry backoff, aborting");
          return;
        }
      }

      const handle = spawnAgentAndWait(agentCmd, worktree.path, agentEnv, timeoutMs);
      const activeEntry = this.active.get(task.id);
      if (activeEntry) {
        activeEntry.process = handle.process;
      } else {
        // Task was cancelled during spawn setup — kill immediately
        handle.process.kill("SIGTERM");
        return;
      }
      result = await handle.result;

      // If task was cancelled during execution, do not retry
      if (!this.active.has(task.id)) {
        logger.info({ taskId: task.id }, "Task cancelled during agent execution");
        return;
      }

      if (result.exitCode === 0) break;

      if (attempt < maxAgentRetries) {
        logger.warn(
          { taskId: task.id, exitCode: result.exitCode, attempt: attempt + 1, maxRetries: maxAgentRetries,
            stderr: result.stderr.slice(-500) },
          "Agent execution failed, will retry",
        );
      }
    }

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
            const verified = await this.runVerificationLoop(
              task, projectConfig, projectName, worktree, agentEnv,
              agentOptions, agent, duration, commands, verifyConfig?.maxRetries ?? 3,
            );
            if (!verified) {
              this.active.delete(task.id);
              return;
            }
          }

          // Commit → push → PR
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

          await this.lifecycle.recordSuccess(ctx, duration, pr.url, projectConfig);

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

          this.emit("taskCompleted", task, {
            duration,
            projectConfig,
            prUrl: pr.url,
            prNumber: pr.number,
            worktreePath: worktree.path,
          });
          logger.info({ taskId: task.id, duration }, "Task completed successfully");
          this.active.delete(task.id);
          return;
        }

        this.emit("taskCompleted", task, { duration, projectConfig });
        logger.info({ taskId: task.id, duration }, "Task completed successfully");
      } catch (err) {
        this.emit("taskFailed", task, err);
        logger.error(
          { taskId: task.id, err, stderr: result.stderr.slice(-MAX_ERROR_SNIPPET_CHARS), stdout: result.stdout.slice(-MAX_ERROR_SNIPPET_CHARS) },
          "Post-agent steps failed",
        );
        await this.lifecycle.recordFailure(ctx, duration, String(err), projectConfig);
      }
    } else {
      const lastStderrSnippet = result.stderr.slice(-MAX_ERROR_SNIPPET_CHARS);
      const lastStdoutSnippet = result.stdout.slice(-MAX_ERROR_SNIPPET_CHARS);
      const errorDetail = lastStderrSnippet || lastStdoutSnippet || "No output captured";
      const errorMsg = `Agent exited with code ${result.exitCode}: ${errorDetail.slice(0, MAX_ERROR_DETAIL_CHARS)}`;

      await this.lifecycle.recordFailure(ctx, duration, errorMsg, projectConfig, lastAttempt > 0 ? lastAttempt : undefined);
      this.emit("taskFailed", task, new Error(`Exit code: ${result.exitCode}`));
      logger.error(
        { taskId: task.id, exitCode: result.exitCode, duration, stderr: lastStderrSnippet, stdout: lastStdoutSnippet },
        "Task failed",
      );
    }

    this.active.delete(task.id);
  }

  private async runVerificationLoop(
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
  ): Promise<boolean> {
    const { payload } = task;
    const ctx: TaskContext = { taskId: payload.taskId, title: payload.title, project: projectName };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const verifyResult = await runVerificationCommands(worktree.path, commands, agentEnv);

      if (verifyResult.success) return true;

      if (attempt === maxRetries) {
        logger.error(
          { taskId: task.id, failedCommand: verifyResult.failedCommand, retries: attempt },
          "Verification failed after max retries",
        );

        const error = `Verification command "${verifyResult.failedCommand}" failed after ${attempt} retries.\n\nOutput:\n${verifyResult.output?.slice(-1000)}`;
        await this.lifecycle.recordFailure(ctx, duration, `Verification failed: ${verifyResult.failedCommand}`, projectConfig);

        await postVerificationFailureComment({
          task,
          projectConfig,
          failedCommand: verifyResult.failedCommand!,
          output: verifyResult.output ?? "",
          retries: attempt,
        });

        this.emit("taskFailed", task, new Error("Verification failed"));
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
      const fixActiveEntry = this.active.get(task.id);
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

  isActive(taskId: string): boolean {
    return this.active.has(taskId);
  }

  cancelTask(taskId: string): boolean {
    const active = this.active.get(taskId);
    if (!active) return false;

    active.abortController.abort();
    active.process?.kill("SIGTERM");

    const proc = active.process;
    if (proc) {
      setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* already dead */
        }
      }, SIGKILL_DELAY_MS);
    }

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

  private async runScheduledCommand(
    task: Task,
    projectConfig: ProjectConfig,
    projectName: string,
    worktree: WorktreeInfo,
    startTime: number,
  ): Promise<boolean> {
    const { payload } = task;
    const command = "scheduledCommand" in payload ? payload.scheduledCommand! : "";

    const abortController = new AbortController();
    const activeTask: ActiveTask = { task, process: null, worktree, startTime, abortController };
    this.active.set(task.id, activeTask);
    this.emit("taskStarted", task);

    const ctx: TaskContext = { taskId: payload.taskId, title: payload.title, project: projectName };
    this.lifecycle.recordStart(ctx);

    this.executeScheduledCommand(
      task, projectConfig, projectName, worktree, command, startTime,
    ).catch((err) => {
      logger.error({ taskId: task.id, err }, "Unhandled error in scheduled command execution");
    });

    return true;
  }

  private async executeScheduledCommand(
    task: Task,
    projectConfig: ProjectConfig,
    projectName: string,
    worktree: WorktreeInfo,
    command: string,
    startTime: number,
  ): Promise<void> {
    const { payload } = task;
    const ctx: TaskContext = { taskId: payload.taskId, title: payload.title, project: projectName };
    const agentEnv: Record<string, string | undefined> = {
      ...(projectConfig.githubToken && { GITHUB_TOKEN: projectConfig.githubToken }),
    };

    try {
      const result = await execCommand(command, worktree.path, agentEnv);
      this.active.delete(task.id);
      const duration = Math.floor((Date.now() - startTime) / 1000);

      if (!result.success) {
        await this.lifecycle.recordFailure(ctx, duration, `Command failed: ${result.output.slice(-1000)}`, projectConfig);
        this.emit("taskFailed", task, new Error("Scheduled command failed"));
        return;
      }

      // Check for changes
      const git = simpleGit(worktree.path);
      const status = await git.status();

      if (status.files.length === 0) {
        logger.info({ taskId: task.id }, "Scheduled command produced no changes, skipping PR");
        this.emit("taskCompleted", task);
        return;
      }

      // Commit, push, create PR
      const scheduledAgentBody = await readAgentPRBody(worktree.path);
      const prDetails = buildPRDetails(task, projectConfig, scheduledAgentBody);
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

      await this.lifecycle.recordSuccess(ctx, duration, pr.url, projectConfig);

      this.emit("taskCompleted", task);
      logger.info({ taskId: task.id, duration, prUrl: pr.url }, "Scheduled command task completed");
    } catch (err) {
      this.active.delete(task.id);
      const duration = Math.floor((Date.now() - startTime) / 1000);
      this.emit("taskFailed", task, err);
      logger.error({ taskId: task.id, err }, "Scheduled command execution failed");
      await this.lifecycle.recordFailure(ctx, duration, String(err), projectConfig);
    }
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
        for (const [id, active] of this.active) {
          active.abortController.abort();
          active.process?.kill("SIGKILL");
          this.active.delete(id);
        }
        resolve();
      }, timeoutMs);
    });
  }
}
