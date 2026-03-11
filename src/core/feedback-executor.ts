import type { TaskExecutor, ExecutorContext, ExecutorResult } from "./executor-types";
import type { AgentSpawner, GitService, FeedbackService } from "./runner-deps";
import type { FeedbackTask } from "./queue";
import { isFeedbackTask } from "./queue";
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
    if (!isFeedbackTask(ctx.task)) {
      throw new Error(`FeedbackExecutor received wrong task type "${ctx.task.type}" (expected "feedback") for task ${ctx.task.id}`);
    }
    const task = ctx.task;

    try {
      await this.deps.git.pullBranch(ctx.worktree.path, ctx.worktree.branch);
    } catch (pullErr) {
      const msg = pullErr instanceof Error ? pullErr.message : String(pullErr);
      const lower = msg.toLowerCase();
      logger.error(
        { taskId: ctx.task.id, branch: ctx.worktree.branch, worktree: ctx.worktree.path, error: msg },
        "Git pull failed for feedback branch"
      );

      let userMessage: string;
      if (lower.includes("conflict") || lower.includes("merge")) {
        userMessage =
          `Git pull failed due to a merge conflict on branch "${ctx.worktree.branch}". ` +
          `To recover: check out the branch manually, resolve conflicts with "git mergetool" or by editing the conflicted files, ` +
          `then run "git add . && git rebase --continue" (or "git merge --continue"). Original error: ${msg}`;
      } else if (lower.includes("reject") || lower.includes("non-fast-forward") || lower.includes("fetch first")) {
        userMessage =
          `Git pull was rejected for branch "${ctx.worktree.branch}" (remote has diverged). ` +
          `To recover: run "git pull --rebase origin ${ctx.worktree.branch}" in the worktree to rebase local changes, ` +
          `or force-push if you own the branch. Original error: ${msg}`;
      } else if (lower.includes("could not resolve") || lower.includes("unable to connect") || lower.includes("network")) {
        userMessage =
          `Git pull failed due to a network or remote connectivity issue for branch "${ctx.worktree.branch}". ` +
          `Check your network connection and remote URL, then retry. Original error: ${msg}`;
      } else {
        userMessage =
          `Git pull failed for branch "${ctx.worktree.branch}". ` +
          `To recover: inspect the worktree at "${ctx.worktree.path}" and resolve any git issues manually. Original error: ${msg}`;
      }

      return { success: false, error: userMessage };
    }

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
