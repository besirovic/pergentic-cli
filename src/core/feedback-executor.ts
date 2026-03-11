import type { TaskExecutor, ExecutorContext, ExecutorResult } from "./executor-types";
import type { AgentSpawner, GitService, FeedbackService } from "./runner-deps";
import type { FeedbackTask } from "./queue";
import { runAgentWithRetry } from "./agent-runner";
import { logger } from "../utils/logger";
import { redactArgs } from "../utils/redact";

const MAX_ERROR_SNIPPET_CHARS = 2000;
const MAX_ERROR_DETAIL_CHARS = 500;

export interface FeedbackExecutorDeps {
  agentSpawner: AgentSpawner;
  git: GitService;
  feedback: FeedbackService;
}

export class FeedbackExecutor implements TaskExecutor {
  constructor(private deps: FeedbackExecutorDeps) {}

  async execute(ctx: ExecutorContext): Promise<ExecutorResult> {
    const task = ctx.task as FeedbackTask;

    await this.deps.git.pullBranch(ctx.worktree.path, ctx.worktree.branch);

    const history =
      (await this.deps.feedback.loadHistory(ctx.worktree.path)) ??
      (await this.deps.feedback.initHistory(ctx.worktree.path, task.payload.taskId, task.payload.description));
    const comment = task.payload.comment ?? "";
    await this.deps.feedback.addFeedbackRound(ctx.worktree.path, comment);
    const prompt = this.deps.feedback.buildFeedbackPrompt(history, comment);

    const agentCmd = ctx.agent.buildCommand(prompt, ctx.worktree.path, ctx.agentOptions);
    logger.info({ taskId: ctx.task.id, command: agentCmd.command, argCount: agentCmd.args.length, cwd: ctx.worktree.path }, "Executing feedback agent command");
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

    await this.deps.git.amendAndForcePush(ctx.worktree.path, ctx.worktree.branch);
    return { success: true };
  }
}
