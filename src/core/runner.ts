import { type ChildProcess } from "node:child_process";
import type { WorktreeInfo } from "./worktree";
import { logger } from "../utils/logger";
import { TypedEventEmitter } from "../types/typed-emitter";
import type { Task, ScheduledPayload, FeedbackPayload } from "./queue";
import { AgentName } from "../config/schema";
import type { GlobalConfig, ProjectConfig } from "../config/schema";
import { buildBranchName, buildBranchTemplateVars, DEFAULT_BRANCH_TEMPLATE } from "./branch-name";
import { buildPromptFromTemplate } from "./prompt-template";
import { type SpawnResult, SIGKILL_DELAY_MS } from "../utils/process";
import { redactArgs } from "../utils/redact";
import { cancellableSleep } from "../utils/sleep";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { repoDir } from "../config/paths";
import { type RunnerDeps, createDefaultDeps } from "./runner-deps";

const MAX_ERROR_SNIPPET_CHARS = 2000;
const MAX_ERROR_DETAIL_CHARS = 500;
const AGENT_RETRY_JITTER_MAX_MS = 1000;
const ERROR_LOG_SNIPPET_CHARS = 500;
const PROCESS_CHECK_INTERVAL_MS = 1000;

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
  /** Optional dependency overrides for testing. Defaults to real implementations. */
  deps?: Partial<RunnerDeps>;
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
  private deps: RunnerDeps;

  constructor(config: RunnerConfig) {
    super();
    this.maxConcurrent = config.maxConcurrent;
    this.globalConfig = config.globalConfig;
    const defaults = createDefaultDeps(config.globalConfig);
    this.deps = { ...defaults, ...config.deps };
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
    const ctx = { taskId: payload.taskId, title: payload.title, project: projectName };

    logger.info(
      { taskId: task.id, project: projectName, type: task.type },
      "Starting task",
    );

    let freshClone = false;
    try {
      const cloneDir = repoDir(projectName);
      const repoExisted = existsSync(join(cloneDir, ".git")) || existsSync(join(cloneDir, "HEAD"));
      await this.deps.worktree.ensureRepoClone(projectName, projectConfig.repo, projectConfig.branch);
      freshClone = !repoExisted;

      const isStandingBranch = task.type === "scheduled"
        && (payload as ScheduledPayload).schedulePrBehavior === "update"
        && !!(payload as ScheduledPayload).schedulePrBranch;

      const worktreeTaskId = isStandingBranch
          ? (payload as ScheduledPayload).schedulePrBranch!
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

      const worktree = await this.deps.worktree.createWorktree(
        projectName,
        worktreeTaskId,
        payload.title,
        projectConfig.branch,
        resolvedBranchName,
      );

      // Build prompt
      let prompt: string;

      if (task.type === "feedback") {
        await this.deps.git.pullBranch(worktree.path, worktree.branch);
        const history =
          (await this.deps.feedback.loadHistory(worktree.path)) ??
          (await this.deps.feedback.initHistory(worktree.path, payload.taskId, payload.description));
        const comment = (payload as FeedbackPayload).comment ?? "";
        await this.deps.feedback.addFeedbackRound(worktree.path, comment);
        prompt = this.deps.feedback.buildFeedbackPrompt(history, comment);
      } else if (task.type === "scheduled" && (payload as ScheduledPayload).scheduledCommand) {
        return this.runScheduledCommand(task, projectConfig, projectName, worktree, startTime);
      } else if (task.type === "scheduled" && !(payload as ScheduledPayload).scheduledCommand) {
        prompt = payload.description;
      } else {
        await this.deps.feedback.initHistory(worktree.path, payload.taskId, payload.description);
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
      const agent = this.deps.agentResolver.resolveAgent(parsedAgent);
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
        { taskId: task.id, command: agentCmd.command, argCount: agentCmd.args.length, cwd: worktree.path },
        "Executing agent command",
      );
      logger.debug(
        { taskId: task.id, args: redactArgs(agentCmd.args) },
        "Agent command args",
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
      await this.deps.lifecycle.recordStart(ctx);

      this.executeTask(
        task, projectConfig, projectName, worktree, agentCmd, agentEnv,
        agentOptions, agent, startTime,
      ).catch((err) => {
        logger.error({ taskId: task.id, err }, "Unhandled error in task execution");
        this.active.delete(task.id);
        this.emit("taskFailed", task, err);
      });

      return true;
    } catch (err) {
      logger.error({ taskId: task.id, err }, "Failed to start task");

      // Clean up freshly cloned repo if worktree creation (or later setup) failed
      if (freshClone) {
        const cloneDir = repoDir(projectName);
        try {
          rmSync(cloneDir, { recursive: true, force: true });
          logger.info({ taskId: task.id, path: cloneDir }, "Cleaned up freshly cloned repo after failure");
        } catch (cleanupErr) {
          logger.warn({ taskId: task.id, err: cleanupErr, path: cloneDir }, "Failed to clean up cloned repo");
        }
      }

      const duration = Math.floor((Date.now() - startTime) / 1000);
      await this.deps.lifecycle.recordFailure(ctx, duration, String(err), projectConfig);
      this.emit("taskFailed", task, err);
      return false;
    }
  }

  private async executeTask(
    task: Task,
    projectConfig: ProjectConfig,
    projectName: string,
    worktree: WorktreeInfo,
    agentCmd: ReturnType<ReturnType<RunnerDeps["agentResolver"]["resolveAgent"]>["buildCommand"]>,
    agentEnv: Record<string, string | undefined>,
    agentOptions: {
      instructions?: string;
      allowedTools?: string[];
      maxCostPerTask?: number;
      model?: string;
    },
    agent: ReturnType<RunnerDeps["agentResolver"]["resolveAgent"]>,
    startTime: number,
  ): Promise<void> {
    const { payload } = task;
    const ctx = { taskId: payload.taskId, title: payload.title, project: projectName };

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

        const delayMs = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * AGENT_RETRY_JITTER_MAX_MS;
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

      const handle = this.deps.agentSpawner.spawnAgentAndWait(agentCmd, worktree.path, agentEnv, timeoutMs);
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
            stderr: result.stderr.slice(-ERROR_LOG_SNIPPET_CHARS) },
          "Agent execution failed, will retry",
        );
      }
    }

    const duration = Math.floor((Date.now() - startTime) / 1000);

    if (result.exitCode === 0) {
      try {
        if (task.type === "feedback") {
          await this.deps.git.amendAndForcePush(worktree.path, worktree.branch);
        } else {
          // Run verification commands for new tasks
          const verifyConfig = projectConfig.verification;
          const commands = verifyConfig?.commands ?? [];

          if (commands.length > 0) {
            const commandTimeoutMs = verifyConfig?.commandTimeout
              ? verifyConfig.commandTimeout * 1000
              : undefined;
            const verified = await this.deps.verification.runVerificationLoop(
              task, projectConfig, projectName, worktree, agentEnv,
              agentOptions, agent, duration, commands, verifyConfig?.maxRetries ?? 3,
              () => this.active.get(task.id),
              commandTimeoutMs,
            );
            if (!verified) {
              this.active.delete(task.id);
              this.emit("taskFailed", task, new Error("Verification failed"));
              return;
            }
          }

          // Commit → push → PR
          const pr = await this.deps.prService.createPRFromWorktree(task, projectConfig, worktree);

          await this.deps.lifecycle.recordSuccess(ctx, duration, pr.url, projectConfig);

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
        await this.deps.lifecycle.recordFailure(ctx, duration, String(err), projectConfig);
      }
    } else {
      const lastStderrSnippet = result.stderr.slice(-MAX_ERROR_SNIPPET_CHARS);
      const lastStdoutSnippet = result.stdout.slice(-MAX_ERROR_SNIPPET_CHARS);
      const errorDetail = lastStderrSnippet || lastStdoutSnippet || "No output captured";
      const errorMsg = `Agent exited with code ${result.exitCode}: ${errorDetail.slice(0, MAX_ERROR_DETAIL_CHARS)}`;

      await this.deps.lifecycle.recordFailure(ctx, duration, errorMsg, projectConfig, lastAttempt > 0 ? lastAttempt : undefined);
      this.emit("taskFailed", task, new Error(`Exit code: ${result.exitCode}`));
      logger.error(
        { taskId: task.id, exitCode: result.exitCode, duration, stderr: lastStderrSnippet, stdout: lastStdoutSnippet },
        "Task failed",
      );
    }

    this.active.delete(task.id);
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
      const killTimer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* already dead */
        }
      }, SIGKILL_DELAY_MS);
      // Don't let the SIGKILL fallback timer keep the Node.js event loop alive
      killTimer.unref();
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
    const command = (payload as ScheduledPayload).scheduledCommand ?? "";

    const abortController = new AbortController();
    const activeTask: ActiveTask = { task, process: null, worktree, startTime, abortController };
    this.active.set(task.id, activeTask);
    this.emit("taskStarted", task);

    const ctx = { taskId: payload.taskId, title: payload.title, project: projectName };
    await this.deps.lifecycle.recordStart(ctx);

    this.deps.scheduledRunner.execute(
      task, projectConfig, projectName, worktree, command, startTime,
    ).then((result) => {
      this.active.delete(task.id);
      if (result.success) {
        this.emit("taskCompleted", task);
      } else {
        this.emit("taskFailed", task, new Error("Scheduled command failed"));
      }
    }).catch((err) => {
      logger.error({ taskId: task.id, err }, "Unhandled error in scheduled command execution");
      this.active.delete(task.id);
      this.emit("taskFailed", task, err);
    });

    return true;
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
      }, PROCESS_CHECK_INTERVAL_MS);

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
