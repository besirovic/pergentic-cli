import type { AgentCommand } from "../agents/types";
import type { AgentSpawner } from "./runner-deps";
import type { ExecutorContext } from "./executor-types";
import type { SpawnResult } from "../utils/process";
import { cancellableSleep } from "../utils/sleep";
import { logger } from "../utils/logger";

const AGENT_RETRY_JITTER_MAX_MS = 1000;
const ERROR_LOG_SNIPPET_CHARS = 500;

/**
 * Spawn an agent and retry on failure using exponential backoff.
 * Shared by all executors that invoke an agent process.
 */
export async function runAgentWithRetry(
  ctx: ExecutorContext,
  agentSpawner: AgentSpawner,
  agentCmd: AgentCommand,
): Promise<{ result: SpawnResult; lastAttempt: number }> {
  const timeoutMs = ctx.projectConfig.claude
    ? ctx.projectConfig.claude.agentTimeout * 1000
    : undefined;

  const agentRetryConfig = ctx.projectConfig.agentRetry;
  const maxAgentRetries = agentRetryConfig?.maxRetries ?? 0;
  const baseDelayMs = (agentRetryConfig?.baseDelaySeconds ?? 30) * 1000;

  let result!: SpawnResult;
  let lastAttempt = 0;

  for (let attempt = 0; attempt <= maxAgentRetries; attempt++) {
    lastAttempt = attempt;

    if (attempt > 0) {
      if (!ctx.isActive()) {
        logger.info({ taskId: ctx.task.id, attempt }, "Task cancelled during agent retry backoff, aborting");
        return { result: { exitCode: -1, stdout: "", stderr: "cancelled" }, lastAttempt };
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * AGENT_RETRY_JITTER_MAX_MS;
      logger.info(
        { taskId: ctx.task.id, attempt, maxRetries: maxAgentRetries, delayMs: Math.round(delayMs) },
        "Retrying agent execution after failure",
      );
      await cancellableSleep(delayMs, ctx.signal);

      if (!ctx.isActive()) {
        logger.info({ taskId: ctx.task.id, attempt }, "Task cancelled during agent retry backoff, aborting");
        return { result: { exitCode: -1, stdout: "", stderr: "cancelled" }, lastAttempt };
      }
    }

    const handle = agentSpawner.spawnAgentAndWait(agentCmd, ctx.worktree.path, ctx.baseAgentEnv, timeoutMs);
    ctx.setProcess(handle.process);

    if (!ctx.isActive()) {
      handle.process.kill("SIGTERM");
      return { result: { exitCode: -1, stdout: "", stderr: "cancelled" }, lastAttempt };
    }

    result = await handle.result;

    if (!ctx.isActive()) {
      logger.info({ taskId: ctx.task.id }, "Task cancelled during agent execution");
      return { result, lastAttempt };
    }

    if (result.exitCode === 0) break;

    if (attempt < maxAgentRetries) {
      logger.warn(
        { taskId: ctx.task.id, exitCode: result.exitCode, attempt: attempt + 1, maxRetries: maxAgentRetries,
          stderr: result.stderr.slice(-ERROR_LOG_SNIPPET_CHARS) },
        "Agent execution failed, will retry",
      );
    }
  }

  return { result, lastAttempt };
}
