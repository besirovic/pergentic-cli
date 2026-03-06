import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { resolveAgent } from "../agents/resolve-agent";
import { createWorktree, ensureRepoClone, removeWorktree, type WorktreeInfo } from "./worktree";
import { commitAll, pushBranch, createPR, amendAndForcePush, pullBranch } from "./git";
import { initHistory, addFeedbackRound, buildFeedbackPrompt, loadHistory } from "./feedback";
import { notify, type TaskEvent } from "./notify";
import { postTaskComments } from "./comments";
import { recordTaskCost } from "./cost";
import { recordEvent } from "./events";
import { logger } from "../utils/logger";
import type { Task } from "./queue";
import type { GlobalConfig, ProjectConfig } from "../config/schema";

export interface RunnerConfig {
  maxConcurrent: number;
  globalConfig: GlobalConfig;
}

interface ActiveTask {
  task: Task;
  process: ChildProcess;
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

      const agentCmd = agent.buildCommand(prompt, worktree.path, {
        instructions: projectConfig.claude?.instructions,
        allowedTools,
        maxCostPerTask: projectConfig.claude?.maxCostPerTask,
      });

      logger.info(
        {
          taskId: task.id,
          command: agentCmd.command,
          args: agentCmd.args,
          cwd: worktree.path,
        },
        "Executing agent command",
      );

      // Spawn agent process
      const child = spawn(agentCmd.command, agentCmd.args, {
        cwd: worktree.path,
        env: {
          ...process.env,
          ...(projectConfig.anthropicApiKey && { ANTHROPIC_API_KEY: projectConfig.anthropicApiKey }),
          ...(projectConfig.openaiApiKey && { OPENAI_API_KEY: projectConfig.openaiApiKey }),
          ...(projectConfig.openrouterApiKey && { OPENROUTER_API_KEY: projectConfig.openrouterApiKey }),
          ...(projectConfig.githubToken && { GITHUB_TOKEN: projectConfig.githubToken }),
          ...agentCmd.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Capture agent output for error reporting
      const stderrChunks: Buffer[] = [];
      const stdoutChunks: Buffer[] = [];
      const MAX_OUTPUT = 8192; // Keep last 8KB of output
      let stderrLen = 0;
      let stdoutLen = 0;

      child.stderr?.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
        stderrLen += chunk.length;
        while (stderrLen > MAX_OUTPUT && stderrChunks.length > 1) {
          stderrLen -= stderrChunks.shift()!.length;
        }
      });

      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
        stdoutLen += chunk.length;
        while (stdoutLen > MAX_OUTPUT && stdoutChunks.length > 1) {
          stdoutLen -= stdoutChunks.shift()!.length;
        }
      });

      const activeTask: ActiveTask = {
        task,
        process: child,
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

      child.on("close", async (exitCode) => {
        const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();
        const stdout = Buffer.concat(stdoutChunks).toString("utf-8").trim();
        this.active.delete(task.id);
        const duration = Math.floor((Date.now() - startTime) / 1000);

        if (exitCode === 0) {
          try {
            if (task.type === "feedback") {
              await amendAndForcePush(worktree.path, worktree.branch);
            } else {
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
              { taskId: task.id, err, stderr: stderr.slice(-2000), stdout: stdout.slice(-2000) },
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
          const lastStderrSnippet = stderr.slice(-2000);
          const lastStdoutSnippet = stdout.slice(-2000);
          const errorDetail = lastStderrSnippet || lastStdoutSnippet || "No output captured";

          recordTaskCost(payload.taskId, 0, duration, false, true, {
            project: projectName,
            title: payload.title,
            error: `Agent exited with code ${exitCode}: ${errorDetail.slice(0, 500)}`,
          });

          recordEvent({
            timestamp: new Date().toISOString(),
            type: "taskFailed",
            taskId: payload.taskId,
            project: projectName,
            title: payload.title,
            duration,
            error: `Agent exited with code ${exitCode}: ${errorDetail.slice(0, 500)}`,
          });

          const errorJson = JSON.stringify(
            { exitCode, detail: errorDetail.slice(0, 500) },
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
          this.emit("taskFailed", task, new Error(`Exit code: ${exitCode}`));
          logger.error(
            { taskId: task.id, exitCode, duration, stderr: lastStderrSnippet, stdout: lastStdoutSnippet },
            "Task failed",
          );
        }
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

  isActive(taskId: string): boolean {
    return this.active.has(taskId);
  }

  cancelTask(taskId: string): boolean {
    const active = this.active.get(taskId);
    if (!active) return false;

    active.process.kill("SIGTERM");
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
          active.process.kill("SIGKILL");
          this.active.delete(id);
        }
        resolve();
      }, timeoutMs);
    });
  }
}
