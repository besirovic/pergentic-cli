import { type ChildProcess } from "node:child_process";
import type { WorktreeInfo } from "./worktree";
import { logger } from "../utils/logger";
import { TypedEventEmitter } from "../types/typed-emitter";
import type { Task } from "./queue";
import { isScheduledTask, isFeedbackTask } from "./queue";
import type { GlobalConfig, ProjectConfig } from "../config/schema";
import { SIGKILL_DELAY_MS } from "../utils/process";
import { rmSync } from "node:fs";
import { repoDir } from "../config/paths";
import { type RunnerDeps, createDefaultDeps } from "./runner-deps";
import type { TaskExecutor } from "./executor-types";
import { TicketExecutor } from "./ticket-executor";
import { FeedbackExecutor } from "./feedback-executor";
import { ScheduledExecutor } from "./scheduled-executor";
import { prepareWorktree, buildExecutorContext } from "./runner-setup";

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
  /** Pending SIGKILL escalation timer; cleared when process exits or task is force-killed. */
  sigkillTimer?: ReturnType<typeof setTimeout>;
  /** True once cancelTask has been called; makes isActive() return false so executors stop. */
  cancelled?: boolean;
}

export class TaskRunner extends TypedEventEmitter<RunnerEvents> {
  private active = new Map<string, ActiveTask>();
  private pendingPromises = new Set<Promise<void>>();
  private maxConcurrent: number;
  private deps: RunnerDeps;
  private ticketExec: TicketExecutor;
  private feedbackExec: FeedbackExecutor;
  private scheduledExec: ScheduledExecutor;

  constructor(config: RunnerConfig) {
    super();
    this.maxConcurrent = config.maxConcurrent;
    const defaults = createDefaultDeps(config.globalConfig);
    const deps = { ...defaults, ...config.deps };
    this.deps = deps;
    this.ticketExec = new TicketExecutor({
      agentSpawner: deps.agentSpawner, feedback: deps.feedback,
      verification: deps.verification, prService: deps.prService,
    });
    this.feedbackExec = new FeedbackExecutor({
      agentSpawner: deps.agentSpawner, git: deps.git, feedback: deps.feedback,
    });
    this.scheduledExec = new ScheduledExecutor({
      scheduledRunner: deps.scheduledRunner, agentSpawner: deps.agentSpawner,
      verification: deps.verification, prService: deps.prService,
    });
  }

  async run(task: Task, projectConfig: ProjectConfig, projectPath: string): Promise<boolean> {
    if (this.active.size >= this.maxConcurrent) return false;

    const startTime = Date.now();
    const projectName = task.project;
    let freshClone = false;

    try {
      const setup = await prepareWorktree(task, projectConfig, projectName, this.deps.worktree);
      freshClone = setup.freshClone;

      const abortController = new AbortController();
      const activeTask: ActiveTask = { task, process: null, worktree: setup.worktree, startTime, abortController };
      this.active.set(task.id, activeTask);

      const ctx = buildExecutorContext(
        task, projectConfig, projectPath, projectName, setup.worktree,
        startTime, abortController.signal, this.deps.agentResolver, this.active,
      );
      const executor = this.selectExecutor(task);

      this.emit("taskStarted", task);
      await this.deps.lifecycle.recordStart({ taskId: task.payload.taskId, title: task.payload.title, project: projectName });

      const p = this.handleExecution(executor, ctx, task, projectConfig, projectName, startTime)
        .finally(() => { this.pendingPromises.delete(p); });
      this.pendingPromises.add(p);
      return true;
    } catch (err) {
      logger.error({ taskId: task.id, err }, "Failed to start task");
      if (freshClone) {
        try { rmSync(repoDir(projectName), { recursive: true, force: true }); } catch { /* ignore */ }
      }
      const duration = Math.floor((Date.now() - startTime) / 1000);
      await this.deps.lifecycle.recordFailure(
        { taskId: task.payload.taskId, title: task.payload.title, project: projectName },
        duration, String(err), projectConfig,
      );
      this.clearActiveTask(task.id);
      this.emit("taskFailed", task, err);
      return false;
    }
  }

  private selectExecutor(task: Task): TaskExecutor {
    if (isFeedbackTask(task)) return this.feedbackExec;
    if (isScheduledTask(task)) return this.scheduledExec;
    return this.ticketExec;
  }

  private async handleExecution(
    executor: TaskExecutor, ctx: import("./executor-types").ExecutorContext,
    task: Task, projectConfig: ProjectConfig, projectName: string, startTime: number,
  ): Promise<void> {
    const lCtx = { taskId: task.payload.taskId, title: task.payload.title, project: projectName };
    try {
      const result = await executor.execute(ctx);
      const duration = Math.floor((Date.now() - startTime) / 1000);
      if (result.success) {
        if (!result.lifecycleHandled) await this.deps.lifecycle.recordSuccess(lCtx, duration, result.prUrl ?? "", projectConfig);
        this.clearActiveTask(task.id);
        this.emit("taskCompleted", task, { duration, projectConfig, prUrl: result.prUrl, prNumber: result.prNumber, worktreePath: ctx.worktree.path });
        logger.info({ taskId: task.id, duration }, "Task completed successfully");
      } else {
        if (!result.lifecycleHandled) await this.deps.lifecycle.recordFailure(lCtx, duration, result.error ?? "Unknown error", projectConfig, result.retriesAttempted);
        this.clearActiveTask(task.id);
        this.emit("taskFailed", task, new Error(result.error ?? "Task failed"));
      }
    } catch (err) {
      logger.error({ taskId: task.id, err }, "Unhandled error in task execution");
      const duration = Math.floor((Date.now() - startTime) / 1000);
      await this.deps.lifecycle.recordFailure(lCtx, duration, String(err), projectConfig);
      this.clearActiveTask(task.id);
      this.emit("taskFailed", task, err);
    }
  }

  /** Clear the SIGKILL escalation timer (if any) and remove the task from the active map. */
  private clearActiveTask(taskId: string): void {
    const active = this.active.get(taskId);
    if (active?.sigkillTimer) {
      clearTimeout(active.sigkillTimer);
      active.sigkillTimer = undefined;
    }
    this.active.delete(taskId);
  }

  isActive(taskId: string): boolean { return this.active.has(taskId); }

  cancelTask(taskId: string): boolean {
    const active = this.active.get(taskId);
    if (!active) return false;
    active.cancelled = true;
    active.abortController.abort();
    if (active.process) {
      const proc = active.process;
      const t = setTimeout(() => {
        active.sigkillTimer = undefined;
        try { proc.kill("SIGKILL"); } catch { /* already dead */ }
      }, SIGKILL_DELAY_MS);
      t.unref();
      active.sigkillTimer = t;
      proc.kill("SIGTERM");
    }
    // Leave the entry in `active` so waitForAll can track and force-kill if needed.
    // handleExecution will remove it once the process actually exits.
    return true;
  }

  get activeTasks(): Array<{ taskId: string; project: string; startTime: number }> {
    return Array.from(this.active.values()).map((a) => ({ taskId: a.task.id, project: a.task.project, startTime: a.startTime }));
  }

  get availableSlots(): number { return this.maxConcurrent - this.active.size; }
  get activeCount(): number { return this.active.size; }

  async waitForAll(timeoutMs: number = 300_000): Promise<void> {
    if (this.active.size === 0 && this.pendingPromises.size === 0) return;
    return new Promise((resolve) => {
      let resolved = false;
      const check = setInterval(() => {
        if (resolved) return;
        if (this.active.size === 0 && this.pendingPromises.size === 0) {
          resolved = true;
          clearInterval(check);
          clearTimeout(timer);
          resolve();
        }
      }, PROCESS_CHECK_INTERVAL_MS);
      const timer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        clearInterval(check);
        for (const [id, a] of this.active) {
          if (a.sigkillTimer) { clearTimeout(a.sigkillTimer); a.sigkillTimer = undefined; }
          a.abortController.abort();
          a.process?.kill("SIGKILL");
          this.active.delete(id);
        }
        resolve();
      }, timeoutMs);
    });
  }
}
