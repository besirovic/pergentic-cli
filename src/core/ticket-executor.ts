import type { TaskExecutor, ExecutorContext, ExecutorResult } from "./executor-types";
import type { AgentSpawner, FeedbackService, VerificationService, PRService } from "./runner-deps";
import { buildPromptFromTemplate } from "./prompt-template";
import { runAgentWithRetry } from "./agent-runner";
import { logger } from "../utils/logger";
import { redactArgs } from "../utils/redact";

const MAX_ERROR_SNIPPET_CHARS = 2000;
const MAX_ERROR_DETAIL_CHARS = 500;

export interface TicketExecutorDeps {
  agentSpawner: AgentSpawner;
  feedback: Pick<FeedbackService, "initHistory">;
  verification: VerificationService;
  prService: PRService;
}

export class TicketExecutor implements TaskExecutor {
  constructor(private deps: TicketExecutorDeps) {}

  async execute(ctx: ExecutorContext): Promise<ExecutorResult> {
    await this.deps.feedback.initHistory(ctx.worktree.path, ctx.task.payload.taskId, ctx.task.payload.description);

    const prompt = await buildPromptFromTemplate({
      projectPath: ctx.projectPath,
      task: ctx.task,
      projectName: ctx.projectName,
      projectConfig: ctx.projectConfig,
      agentName: ctx.agentName,
      worktreePath: ctx.worktree.path,
    });

    const agentCmd = ctx.agent.buildCommand(prompt, ctx.worktree.path, ctx.agentOptions);
    logger.info({ taskId: ctx.task.id, command: agentCmd.command, argCount: agentCmd.args.length, cwd: ctx.worktree.path }, "Executing agent command");
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
