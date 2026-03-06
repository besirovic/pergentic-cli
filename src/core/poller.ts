import { basename } from "node:path";
import type { ProjectContext } from "../providers/types";
import { LinearProvider } from "../providers/linear";
import { GitHubProvider } from "../providers/github";
import { TaskQueue, type Task } from "./queue";
import { TaskRunner } from "./runner";
import { DispatchLedger } from "./ledger";
import { loadProjectConfig, loadProjectsRegistry } from "../config/loader";
import { logger } from "../utils/logger";

export interface PollerConfig {
  pollInterval: number; // seconds
}

export class Poller {
  private queue: TaskQueue;
  private runner: TaskRunner;
  private ledger: DispatchLedger;
  private pollInterval: number;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    queue: TaskQueue,
    runner: TaskRunner,
    config: PollerConfig,
    ledger: DispatchLedger,
  ) {
    this.queue = queue;
    this.runner = runner;
    this.ledger = ledger;
    this.pollInterval = config.pollInterval * 1000;
  }

  async start(): Promise<void> {
    this.running = true;
    logger.info("Poller started");
    await this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info("Poller stopped");
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    try {
      await this.pollAll();
      await this.dispatch();
    } catch (err) {
      logger.error({ err }, "Poll cycle error");
    }

    if (this.running) {
      this.timer = setTimeout(() => this.tick(), this.pollInterval);
    }
  }

  private async pollAll(): Promise<void> {
    const registry = loadProjectsRegistry();

    for (const entry of registry.projects) {
      const projectName = basename(entry.path);
      let projectConfig;
      try {
        projectConfig = loadProjectConfig(entry.path);
      } catch (err) {
        logger.warn(
          { project: projectName, err },
          "Failed to load project config, skipping",
        );
        continue;
      }

      const context: ProjectContext = {
        name: projectName,
        path: entry.path,
        repo: projectConfig.repo,
        branch: projectConfig.branch,
        agent: projectConfig.agent,
        linearTeamId: projectConfig.linearTeamId,
      };

      // Create providers from per-project credentials
      const providers = [];
      if (projectConfig.linearApiKey) {
        providers.push(new LinearProvider(projectConfig.linearApiKey));
      }
      if (projectConfig.githubToken) {
        providers.push(new GitHubProvider(projectConfig.githubToken));
      }

      for (const provider of providers) {
        try {
          const tasks = await provider.poll(context);
          for (const incoming of tasks) {
            // Skip if already dispatched to an agent (persistent check)
            if (this.ledger.isDispatched(incoming.id)) {
              continue;
            }

            // Skip if currently being executed by the runner
            if (this.runner.isActive(incoming.id)) {
              continue;
            }

            const task: Task = {
              id: incoming.id,
              project: projectName,
              priority: incoming.priority,
              type: incoming.type,
              createdAt: Date.now(),
              payload: {
                taskId: incoming.id,
                title: incoming.title,
                description: incoming.description,
                source: incoming.source,
                metadata: incoming.metadata,
              },
            };

            if (this.queue.add(task)) {
              logger.info(
                { taskId: task.id, project: projectName, source: provider.name },
                "Queued new task",
              );
            }
          }
        } catch (err) {
          logger.error(
            { provider: provider.name, project: projectName, err },
            "Provider poll failed",
          );
        }
      }
    }
  }

  private async dispatch(): Promise<void> {
    while (this.runner.availableSlots > 0 && this.queue.length > 0) {
      const task = this.queue.next();
      if (!task) break;

      try {
        const projectConfig = loadProjectConfig(
          loadProjectsRegistry().projects.find(
            (p) => basename(p.path) === task.project,
          )?.path ?? "",
        );
        const started = await this.runner.run(task, projectConfig);
        if (started) {
          const ledgerType = task.type === "feedback" ? "comment" : "task";
          this.ledger.markDispatched(task.id, ledgerType);
        } else {
          this.queue.markFailed(task.id);
          logger.error({ taskId: task.id }, "Task failed to start, will not retry");
        }
      } catch (err) {
        this.queue.markFailed(task.id);
        logger.error({ taskId: task.id, err }, "Failed to dispatch task, will not retry");
      }
    }
  }
}
