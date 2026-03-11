import type { ChildProcess } from "node:child_process";
import type { Agent, AgentOptions } from "../agents/types";
import type { WorktreeInfo } from "./worktree";
import type { Task } from "./queue";
import type { ProjectConfig } from "../config/schema";

export interface ExecutorContext {
  task: Task;
  projectConfig: ProjectConfig;
  projectName: string;
  projectPath: string;
  worktree: WorktreeInfo;
  startTime: number;
  signal: AbortSignal;
  setProcess: (process: ChildProcess | null) => void;
  isActive: () => boolean;
  getActiveEntry: () => { process: ChildProcess | null } | undefined;
  agent: Agent;
  agentName: string;
  baseAgentEnv: Record<string, string | undefined>;
  agentOptions: AgentOptions;
}

export interface ExecutorResult {
  success: boolean;
  prUrl?: string;
  prNumber?: number;
  error?: string;
  retriesAttempted?: number;
  /** When true, the executor already handled lifecycle recording (e.g. ScheduledCommandRunner). */
  lifecycleHandled?: boolean;
}

export interface TaskExecutor {
  execute(ctx: ExecutorContext): Promise<ExecutorResult>;
}
