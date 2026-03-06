import type { ProjectConfig } from "../config/schema";
import { AgentName } from "../config/schema";

export type AgentNameType = ProjectConfig["configuredAgents"][number];

export interface AgentModelTarget {
  agent: AgentNameType;
  model?: string;
  modelLabel?: string;
}

/**
 * Resolves which agents should handle a task based on ticket labels
 * and the agentLabels mapping in project config.
 *
 * Returns the default agent if no labels match or agentLabels is not configured.
 * Returns multiple agents if labels match multiple configured agents.
 */
export function resolveTargetAgents(
  labels: string[],
  config: ProjectConfig,
): AgentNameType[] {
  const agentLabels = config.agentLabels;

  if (!agentLabels || labels.length === 0) {
    return [config.agent];
  }

  const normalizedLabels = labels.map((l) => l.toLowerCase().trim());
  const matchedAgents: AgentNameType[] = [];

  for (const [agent, agentLabelList] of Object.entries(agentLabels)) {
    const parsed = AgentName.safeParse(agent);
    if (!parsed.success) continue;

    const agentName = parsed.data;
    if (!config.configuredAgents.includes(agentName)) continue;

    const normalizedAgentLabels = agentLabelList.map((l) => l.toLowerCase().trim());
    const hasMatch = normalizedLabels.some((l) => normalizedAgentLabels.includes(l));

    if (hasMatch) {
      matchedAgents.push(agentName);
    }
  }

  return matchedAgents.length > 0 ? matchedAgents : [config.agent];
}

/**
 * Resolves agents and models from ticket labels using both agentLabels and modelLabels config.
 *
 * - Model labels implicitly select their associated agent (no separate agent label needed)
 * - Multiple model labels for one agent → one target per model (separate PRs)
 * - Agents matched only via agentLabels get no model (use agent default)
 */
export function resolveTargetAgentsWithModels(
  labels: string[],
  config: ProjectConfig,
): AgentModelTarget[] {
  const agentLabels = config.agentLabels;
  const modelLabels = config.modelLabels;

  if ((!agentLabels && !modelLabels) || labels.length === 0) {
    return [{ agent: config.agent }];
  }

  const normalizedLabels = labels.map((l) => l.toLowerCase().trim());

  // Phase 1: Match agentLabels → set of agents
  const agentOnlyMatches = new Set<AgentNameType>();

  if (agentLabels) {
    for (const [agent, agentLabelList] of Object.entries(agentLabels)) {
      const parsed = AgentName.safeParse(agent);
      if (!parsed.success) continue;

      const agentName = parsed.data;
      if (!config.configuredAgents.includes(agentName)) continue;

      const normalizedAgentLabels = agentLabelList.map((l) => l.toLowerCase().trim());
      if (normalizedLabels.some((l) => normalizedAgentLabels.includes(l))) {
        agentOnlyMatches.add(agentName);
      }
    }
  }

  // Phase 2: Match modelLabels → AgentModelTarget[]
  const modelTargets: AgentModelTarget[] = [];
  const agentsWithModelTargets = new Set<AgentNameType>();

  if (modelLabels) {
    for (const [agent, labelModelMap] of Object.entries(modelLabels)) {
      const parsed = AgentName.safeParse(agent);
      if (!parsed.success) continue;

      const agentName = parsed.data;
      if (!config.configuredAgents.includes(agentName)) continue;

      for (const [labelName, modelId] of Object.entries(labelModelMap)) {
        if (normalizedLabels.includes(labelName.toLowerCase().trim())) {
          modelTargets.push({
            agent: agentName,
            model: modelId,
            modelLabel: labelName,
          });
          agentsWithModelTargets.add(agentName);
        }
      }
    }
  }

  // Phase 3: Merge — agents with model targets use those, others get default (no model)
  const results: AgentModelTarget[] = [...modelTargets];

  for (const agent of agentOnlyMatches) {
    if (!agentsWithModelTargets.has(agent)) {
      results.push({ agent });
    }
  }

  return results.length > 0 ? results : [{ agent: config.agent }];
}
