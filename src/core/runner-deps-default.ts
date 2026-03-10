import { ensureRepoClone, createWorktree } from "./worktree";
import { pullBranch, amendAndForcePush } from "./git";
import * as feedback from "./feedback";
import { resolveAgent } from "../agents/resolve-agent";
import { spawnAgentAndWait } from "./verify";
import { TaskLifecycle } from "./task-lifecycle";
import { PRCreationService } from "./pr-service";
import { VerificationRunner } from "./verification-runner";
import { ScheduledCommandRunner } from "./scheduled-runner";
import type { GlobalConfig } from "../config/schema";
import type { RunnerDeps } from "./runner-deps";

/** Create the default production dependencies. */
export function createDefaultDeps(globalConfig: GlobalConfig): RunnerDeps {
  const lifecycle = new TaskLifecycle(globalConfig);
  const prService = new PRCreationService();
  const verification = new VerificationRunner(lifecycle);
  const scheduledRunner = new ScheduledCommandRunner(lifecycle, prService);

  return {
    worktree: { ensureRepoClone, createWorktree },
    git: { pullBranch, amendAndForcePush },
    feedback: {
      loadHistory: feedback.loadHistory,
      initHistory: feedback.initHistory,
      addFeedbackRound: feedback.addFeedbackRound,
      buildFeedbackPrompt: feedback.buildFeedbackPrompt,
    },
    agentResolver: { resolveAgent },
    agentSpawner: { spawnAgentAndWait },
    lifecycle,
    prService,
    verification,
    scheduledRunner,
  };
}
