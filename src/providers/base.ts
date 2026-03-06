import type { TaskProvider, IncomingTask, TaskResult, ProjectContext } from "./types";
import { logger } from "../utils/logger";

export abstract class BaseProvider implements TaskProvider {
  abstract name: string;

  abstract fetchTasks(project: ProjectContext): Promise<IncomingTask[]>;

  async poll(project: ProjectContext): Promise<IncomingTask[]> {
    try {
      return await this.fetchTasks(project);
    } catch (err) {
      logger.error({ err, provider: this.name }, "Provider poll failed");
      return [];
    }
  }

  abstract onComplete(
    project: ProjectContext,
    taskId: string,
    result: TaskResult,
  ): Promise<void>;
}
