import type { ChildProcess } from "node:child_process";
import type { Agent } from "../agents/types";
import type { WorktreeInfo } from "./worktree";
import type { FeedbackHistory } from "./feedback";
import type { SpawnResult } from "../utils/process";
import type { AgentCommand } from "../agents/types";
import type { PRResult } from "./pr-service";
import type { Task } from "./queue";
import type { ProjectConfig, GlobalConfig } from "../config/schema";
import type { TaskContext } from "./task-lifecycle";

// ---------------------------------------------------------------------------
// Service interfaces — each groups related functions used by TaskRunner.
// In production the real implementations are wired in via createDefaultDeps().
// In tests, any subset can be replaced with mocks/stubs.
// ---------------------------------------------------------------------------

export interface WorktreeService {
  ensureRepoClone(projectName: string, remoteUrl: string, baseBranch: string): Promise<string>;
  createWorktree(
    projectName: string,
    taskId: string,
    taskTitle: string,
    baseBranch: string,
    branchNameOverride?: string,
  ): Promise<WorktreeInfo>;
}

export interface GitService {
  pullBranch(worktreePath: string, branch: string): Promise<void>;
  amendAndForcePush(worktreePath: string, branch: string): Promise<void>;
}

export interface FeedbackService {
  loadHistory(worktreePath: string): Promise<FeedbackHistory | null>;
  initHistory(worktreePath: string, taskId: string, description: string): Promise<FeedbackHistory>;
  addFeedbackRound(worktreePath: string, comment: string): Promise<FeedbackHistory>;
  buildFeedbackPrompt(history: FeedbackHistory, comment: string): string;
}

export interface AgentResolver {
  resolveAgent(name: string): Agent;
}

export interface AgentSpawner {
  spawnAgentAndWait(
    agentCmd: AgentCommand,
    cwd: string,
    env: Record<string, string | undefined>,
    timeoutMs?: number,
  ): { process: ChildProcess; result: Promise<SpawnResult> };
}

export interface LifecycleService {
  recordStart(ctx: TaskContext): Promise<void>;
  recordSuccess(ctx: TaskContext, duration: number, prUrl: string, projectConfig?: ProjectConfig): Promise<void>;
  recordFailure(ctx: TaskContext, duration: number, error: string, projectConfig?: ProjectConfig, retriesAttempted?: number): Promise<void>;
}

export interface PRService {
  createPRFromWorktree(task: Task, projectConfig: ProjectConfig, worktree: WorktreeInfo): Promise<PRResult>;
}

export interface VerificationService {
  runVerificationLoop(
    task: Task,
    projectConfig: ProjectConfig,
    projectName: string,
    worktree: WorktreeInfo,
    agentEnv: Record<string, string | undefined>,
    agentOptions: {
      instructions?: string;
      allowedTools?: string[];
      maxCostPerTask?: number;
      model?: string;
    },
    agent: Agent,
    duration: number,
    commands: string[],
    maxRetries: number,
    getActiveTask: () => { process: ChildProcess | null } | undefined,
  ): Promise<boolean>;
}

export interface ScheduledCommandService {
  execute(
    task: Task,
    projectConfig: ProjectConfig,
    projectName: string,
    worktree: WorktreeInfo,
    command: string,
    startTime: number,
  ): Promise<{ success: boolean; prUrl?: string }>;
}

/** All injectable dependencies for TaskRunner. */
export interface RunnerDeps {
  worktree: WorktreeService;
  git: GitService;
  feedback: FeedbackService;
  agentResolver: AgentResolver;
  agentSpawner: AgentSpawner;
  lifecycle: LifecycleService;
  prService: PRService;
  verification: VerificationService;
  scheduledRunner: ScheduledCommandService;
}

/** Create the default production dependencies. */
export { createDefaultDeps } from "./runner-deps-default";
