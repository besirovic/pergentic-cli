import type { ProjectConfig } from "../config/schema";
import { AgentName } from "../config/schema";

type AgentNameType = ProjectConfig["configuredAgents"][number];

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
