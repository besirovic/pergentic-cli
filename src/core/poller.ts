import { basename } from "node:path";
import type { ProjectContext, TaskProvider } from "../providers/types";
import { LinearProvider } from "../providers/linear";
import { GitHubProvider } from "../providers/github";
import { TaskQueue, TaskPriority, type Task } from "./queue";
import { TaskRunner } from "./runner";
import { DispatchLedger } from "./ledger";
import { resolveTargetAgentsWithModels } from "./resolve-target-agents";
import { validateLabels } from "./validate-labels";
import { loadProjectsRegistry } from "../config/loader";
import { getCachedProjectConfig } from "../config/cache";
import type { ProjectConfig } from "../config/schema";
import { logger } from "../utils/logger";

export interface PollerConfig {
  pollInterval: number; // seconds
}

interface CachedProviders {
  fingerprint: string;
  providers: TaskProvider[];
}

export class Poller {
  private queue: TaskQueue;
  private runner: TaskRunner;
  private ledger: DispatchLedger;
  private pollInterval: number;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private afterPollHook: (() => Promise<void>) | null = null;
  private providerCache = new Map<string, CachedProviders>();

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

  setAfterPollHook(fn: () => Promise<void>): void {
    this.afterPollHook = fn;
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
      if (this.afterPollHook) await this.afterPollHook();
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
        projectConfig = getCachedProjectConfig(entry.path);
      } catch (err) {
        logger.warn(
          { project: projectName, err },
          "Failed to load project config, skipping",
        );
        continue;
      }

      // Validate labels config
      const labelErrors = validateLabels(projectConfig);
      if (labelErrors.length > 0) {
        for (const err of labelErrors) {
          logger.warn(
            { project: projectName, label: err.label, type: err.type },
            `Label validation: ${err.details}`,
          );
        }
        logger.warn({ project: projectName }, "Skipping project due to label config errors");
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

      const providers = this.getProviders(entry.path, projectConfig);

      for (const provider of providers) {
        try {
          const tasks = await provider.poll(context);
          for (const incoming of tasks) {
            // Feedback tasks skip label resolution — they use the original agent
            if (incoming.type === "feedback") {
              if (this.ledger.isDispatched(incoming.id)) continue;
              if (this.runner.isActive(incoming.id)) continue;

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
                  labels: incoming.labels,
                },
              };

              if (this.queue.add(task)) {
                logger.info(
                  { taskId: task.id, project: projectName, source: provider.name },
                  "Queued feedback task",
                );
              }
              continue;
            }

            // Resolve which agents (and models) should handle this task based on labels
            const targets = resolveTargetAgentsWithModels(
              incoming.labels,
              projectConfig,
            );

            for (const target of targets) {
              // Multi-target tasks get suffixed IDs to avoid collision
              const taskId = targets.length > 1
                ? `${incoming.id}-${target.agent}${target.modelLabel ? `-${target.modelLabel}` : ""}`
                : incoming.id;

              if (this.ledger.isDispatched(taskId)) continue;
              if (this.runner.isActive(taskId)) continue;

              const task: Task = {
                id: taskId,
                project: projectName,
                priority: incoming.priority,
                type: incoming.type,
                createdAt: Date.now(),
                payload: {
                  taskId: taskId,
                  title: incoming.title,
                  description: incoming.description,
                  source: incoming.source,
                  metadata: incoming.metadata,
                  labels: incoming.labels,
                  targetAgents: [target.agent],
                  targetModel: target.model,
                  targetModelLabel: target.modelLabel,
                },
              };

              if (this.queue.add(task)) {
                logger.info(
                  { taskId, project: projectName, source: provider.name, agent: target.agent, model: target.model },
                  "Queued task for agent",
                );
              }
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

    // Clean up cached providers for projects no longer in the registry
    const activeProjectPaths = new Set(registry.projects.map((p) => p.path));
    for (const key of this.providerCache.keys()) {
      if (!activeProjectPaths.has(key)) {
        this.providerCache.delete(key);
      }
    }
  }

  private getProviders(
    projectPath: string,
    config: ProjectConfig,
  ): TaskProvider[] {
    const fingerprint = `${config.linearApiKey ?? ""}:${config.githubToken ?? ""}`;
    const cached = this.providerCache.get(projectPath);
    if (cached && cached.fingerprint === fingerprint) {
      return cached.providers;
    }

    const providers: TaskProvider[] = [];
    if (config.linearApiKey) {
      providers.push(new LinearProvider(config.linearApiKey));
    }
    if (config.githubToken) {
      providers.push(new GitHubProvider(config.githubToken));
    }
    this.providerCache.set(projectPath, { fingerprint, providers });
    return providers;
  }

  private async dispatch(): Promise<void> {
    while (this.runner.availableSlots > 0 && this.queue.length > 0) {
      const task = this.queue.next();
      if (!task) break;

      try {
        const projectPath = loadProjectsRegistry().projects.find(
          (p) => basename(p.path) === task.project,
        )?.path ?? "";
        const projectConfig = getCachedProjectConfig(projectPath);
        const started = await this.runner.run(task, projectConfig, projectPath);
        if (started) {
          const ledgerType = task.type === "feedback" ? "comment" : "task";
          await this.ledger.markDispatched(task.id, ledgerType);
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
