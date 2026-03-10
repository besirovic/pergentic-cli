import { recordTaskCost } from "./cost";
import { recordEvent, type LifecycleEvent } from "./events";
import { notify, type TaskEvent } from "./notify";
import type { GlobalConfig, ProjectConfig } from "../config/schema";

export interface TaskContext {
  taskId: string;
  title: string;
  project: string;
}

export class TaskLifecycle {
  private globalConfig: GlobalConfig;

  constructor(globalConfig: GlobalConfig) {
    this.globalConfig = globalConfig;
  }

  async recordStart(ctx: TaskContext): Promise<void> {
    await recordEvent({
      timestamp: new Date().toISOString(),
      type: "taskStarted",
      taskId: ctx.taskId,
      project: ctx.project,
      title: ctx.title,
    });
  }

  async recordSuccess(
    ctx: TaskContext,
    duration: number,
    prUrl: string,
    projectConfig?: ProjectConfig,
  ): Promise<void> {
    await recordTaskCost(ctx.taskId, 0, duration, true, false, {
      project: ctx.project,
      title: ctx.title,
      prUrl,
    });

    await recordEvent({
      timestamp: new Date().toISOString(),
      type: "prCreated",
      taskId: ctx.taskId,
      project: ctx.project,
      title: ctx.title,
      duration,
      prUrl,
    });

    const event: TaskEvent = {
      type: "prCreated",
      taskId: ctx.taskId,
      title: ctx.title,
      project: ctx.project,
      prUrl,
      duration,
    };
    await notify(event, this.globalConfig, projectConfig);
  }

  async recordFailure(
    ctx: TaskContext,
    duration: number,
    error: string,
    projectConfig?: ProjectConfig,
    retriesAttempted?: number,
  ): Promise<void> {
    await recordTaskCost(ctx.taskId, 0, duration, false, true, {
      project: ctx.project,
      title: ctx.title,
      error,
    });

    await recordEvent({
      timestamp: new Date().toISOString(),
      type: "taskFailed",
      taskId: ctx.taskId,
      project: ctx.project,
      title: ctx.title,
      duration,
      error,
      retriesAttempted,
    });

    const event: TaskEvent = {
      type: "taskFailed",
      taskId: ctx.taskId,
      title: ctx.title,
      project: ctx.project,
      error,
      duration,
      retriesAttempted,
    };
    await notify(event, this.globalConfig, projectConfig);
  }
}
