import type { TaskExecutor, ExecutorContext, ExecutorResult } from "./executor-types";
import type { AgentSpawner, ScheduledCommandService, VerificationService, PRService } from "./runner-deps";
import type { ScheduledTask } from "./queue";
import { isScheduledTask } from "./queue";
import { runAgentWithRetry } from "./agent-runner";
import { logger } from "../utils/logger";
import { redactArgs } from "../utils/redact";

const MAX_ERROR_SNIPPET_CHARS = 2000;
const MAX_ERROR_DETAIL_CHARS = 500;

export interface ScheduledExecutorDeps {
  scheduledRunner: ScheduledCommandService;
  agentSpawner: AgentSpawner;
  verification: VerificationService;
  prService: PRService;
}

export class ScheduledExecutor implements TaskExecutor {
  constructor(private deps: ScheduledExecutorDeps) {}

  async execute(ctx: ExecutorContext): Promise<ExecutorResult> {
    if (!isScheduledTask(ctx.task)) {
      throw new Error(`ScheduledExecutor received wrong task type "${ctx.task.type}" (expected "scheduled") for task ${ctx.task.id}`);
    }
    const task = ctx.task;

    // Command-type: delegate to ScheduledCommandRunner (handles its own lifecycle)
    if (task.payload.scheduledCommand) {
      const timeoutMs = task.payload.scheduleTimeout;
      const result = await this.deps.scheduledRunner.execute(
        task, ctx.projectConfig, ctx.projectName, ctx.worktree,
        task.payload.scheduledCommand, ctx.startTime, timeoutMs,
      );
      return { success: result.success, prUrl: result.prUrl, lifecycleHandled: true };
    }

    // Prompt-type: run agent, verify, create PR
    const prompt = task.payload.description;
    const agentCmd = ctx.agent.buildCommand(prompt, ctx.worktree.path, ctx.agentOptions);
    logger.info({ taskId: ctx.task.id, command: agentCmd.command, argCount: agentCmd.args.length, cwd: ctx.worktree.path }, "Executing scheduled agent command");
    logger.debug({ taskId: ctx.task.id, args: redactArgs(agentCmd.args) }, "Agent command args");

    const { result, lastAttempt } = await runAgentWithRetry(ctx, this.deps.agentSpawner, agentCmd);

    if (result.exitCode !== 0) {
      const snippet = result.stderr.slice(-MAX_ERROR_SNIPPET_CHARS) || result.stdout.slice(-MAX_ERROR_SNIPPET_CHARS) || "No output captured";
      return {
        success: false,
        error: `Agent exited with code ${result.exitCode}: ${snippet.slice(0, MAX_ERROR_DETAIL_CHARS)}`,
        retriesAttempted: lastAttempt > 0 ? lastAttempt : undefined,
      };
    }

    const verifyConfig = ctx.projectConfig.verification;
    const commands = verifyConfig?.commands ?? [];
    if (commands.length > 0) {
      const commandTimeoutMs = verifyConfig ? verifyConfig.commandTimeout * 1000 : undefined;
      const verified = await this.deps.verification.runVerificationLoop(
        ctx.task, ctx.projectConfig, ctx.projectName, ctx.worktree, ctx.baseAgentEnv,
        ctx.agentOptions, ctx.agent, Math.floor((Date.now() - ctx.startTime) / 1000),
        commands, verifyConfig?.maxRetries ?? 3, ctx.getActiveEntry, commandTimeoutMs,
      );
      if (!verified) return { success: false, error: "Verification failed" };
    }

    const pr = await this.deps.prService.createPRFromWorktree(ctx.task, ctx.projectConfig, ctx.worktree);
    return { success: true, prUrl: pr.url, prNumber: pr.number };
  }
}
