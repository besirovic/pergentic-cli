import type { Task } from "./queue";
import { isScheduledTask } from "./queue";
import { AgentName } from "../config/schema";
import type { ProjectConfig } from "../config/schema";
import { buildBranchName, buildBranchTemplateVars, DEFAULT_BRANCH_TEMPLATE } from "./branch-name";
import type { WorktreeInfo } from "./worktree";
import type { WorktreeService, AgentResolver } from "./runner-deps";
import type { ExecutorContext } from "./executor-types";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { repoDir } from "../config/paths";

export async function prepareWorktree(
  task: Task, projectConfig: ProjectConfig, projectName: string, worktreeSvc: WorktreeService,
): Promise<{ worktree: WorktreeInfo; freshClone: boolean }> {
  const cloneDir = repoDir(projectName);
  const repoExisted = existsSync(join(cloneDir, ".git")) || existsSync(join(cloneDir, "HEAD"));
  await worktreeSvc.ensureRepoClone(projectName, projectConfig.repo, projectConfig.branch);

  let isStandingBranch = false;
  let worktreeTaskId = task.payload.taskId;
  if (isScheduledTask(task) && task.payload.schedulePrBehavior === "update" && task.payload.schedulePrBranch) {
    isStandingBranch = true;
    worktreeTaskId = task.payload.schedulePrBranch;
  }

  const rawAgentName = task.payload.targetAgents?.[0] ?? projectConfig.agent;
  const agentParseResult = AgentName.safeParse(rawAgentName);
  if (!agentParseResult.success) {
    const validOptions = AgentName.options.join(", ");
    throw new Error(`Invalid agent name "${rawAgentName}". Valid options are: ${validOptions}`);
  }
  const parsedAgent = agentParseResult.data;

  let resolvedBranchName: string | undefined;
  const branchTemplate = projectConfig.branching?.template;
  if (!isStandingBranch && branchTemplate && branchTemplate !== DEFAULT_BRANCH_TEMPLATE) {
    const vars = buildBranchTemplateVars(branchTemplate, {
      taskId: worktreeTaskId, title: task.payload.title, source: task.payload.source,
      taskType: task.type, project: projectName, agent: parsedAgent,
      labels: task.payload.labels ?? [], typeMap: projectConfig.branching?.typeMap,
    });
    resolvedBranchName = buildBranchName(branchTemplate, vars);
  }

  const worktree = await worktreeSvc.createWorktree(
    projectName, worktreeTaskId, task.payload.title, projectConfig.branch, resolvedBranchName,
  );
  return { worktree, freshClone: !repoExisted };
}

export function buildExecutorContext(
  task: Task, projectConfig: ProjectConfig, projectPath: string,
  projectName: string, worktree: WorktreeInfo, startTime: number,
  signal: AbortSignal, agentResolver: AgentResolver,
  activeMap: Map<string, { process: import("node:child_process").ChildProcess | null; cancelled?: boolean }>,
): ExecutorContext {
  const rawAgentName = task.payload.targetAgents?.[0] ?? projectConfig.agent;
  const agentParseResult = AgentName.safeParse(rawAgentName);
  if (!agentParseResult.success) {
    const validOptions = AgentName.options.join(", ");
    throw new Error(`Invalid agent name "${rawAgentName}". Valid options are: ${validOptions}`);
  }
  const parsedAgent = agentParseResult.data;
  const agent = agentResolver.resolveAgent(parsedAgent);
  const allowedTools = projectConfig.agentTools?.[parsedAgent] ?? projectConfig.claude?.allowedTools;

  return {
    task, projectConfig, projectName, projectPath, worktree, startTime, signal,
    setProcess: (proc) => { const e = activeMap.get(task.id); if (e && !e.cancelled) e.process = proc; },
    isActive: () => { const e = activeMap.get(task.id); return e !== undefined && !e.cancelled; },
    getActiveEntry: () => activeMap.get(task.id) ?? undefined,
    agent, agentName: parsedAgent,
    baseAgentEnv: {
      ...(projectConfig.anthropicApiKey && { ANTHROPIC_API_KEY: projectConfig.anthropicApiKey }),
      ...(projectConfig.openaiApiKey && { OPENAI_API_KEY: projectConfig.openaiApiKey }),
      ...(projectConfig.openrouterApiKey && { OPENROUTER_API_KEY: projectConfig.openrouterApiKey }),
      ...(projectConfig.githubToken && { GITHUB_TOKEN: projectConfig.githubToken }),
      ...agent.buildCommand("", worktree.path).env,
    },
    agentOptions: {
      instructions: projectConfig.claude?.instructions,
      allowedTools,
      maxCostPerTask: projectConfig.claude?.maxCostPerTask,
      model: task.payload.targetModel,
    },
  };
}
