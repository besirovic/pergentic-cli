import type { ProjectConfig } from "../config/schema";
import { AgentName } from "../config/schema";

export interface LabelValidationError {
  type: "duplicate" | "conflict";
  label: string;
  details: string;
}

/**
 * Validates that agentLabels and modelLabels have no conflicts:
 * - No label name appears in both agentLabels and modelLabels
 * - No label name appears under multiple agents within modelLabels
 * - All agents referenced in modelLabels exist in configuredAgents
 */
export function validateLabels(config: ProjectConfig): LabelValidationError[] {
  const errors: LabelValidationError[] = [];
  const agentLabels = config.agentLabels;
  const modelLabels = config.modelLabels;

  if (!agentLabels && !modelLabels) return errors;

  // Collect all agent label names (normalized)
  const agentLabelSet = new Map<string, string>(); // normalized → agent
  if (agentLabels) {
    for (const [agent, labels] of Object.entries(agentLabels)) {
      for (const label of labels) {
        agentLabelSet.set(label.toLowerCase().trim(), agent);
      }
    }
  }

  if (!modelLabels) return errors;

  // Track model label names across agents for duplicate detection
  const modelLabelAgents = new Map<string, string>(); // normalized label → first agent

  for (const [agent, labelModelMap] of Object.entries(modelLabels)) {
    const parsed = AgentName.safeParse(agent);
    if (!parsed.success) continue;

    const agentName = parsed.data;

    // Check agent is configured
    if (!config.configuredAgents.includes(agentName)) continue;

    for (const labelName of Object.keys(labelModelMap)) {
      const normalized = labelName.toLowerCase().trim();

      // Check conflict with agentLabels
      const conflictAgent = agentLabelSet.get(normalized);
      if (conflictAgent) {
        errors.push({
          type: "conflict",
          label: labelName,
          details: `Label "${labelName}" appears in both agentLabels (${conflictAgent}) and modelLabels (${agent})`,
        });
      }

      // Check duplicate across agents within modelLabels
      const existingAgent = modelLabelAgents.get(normalized);
      if (existingAgent && existingAgent !== agent) {
        errors.push({
          type: "duplicate",
          label: labelName,
          details: `Label "${labelName}" appears under multiple agents in modelLabels: ${existingAgent} and ${agent}`,
        });
      } else {
        modelLabelAgents.set(normalized, agent);
      }
    }
  }

  return errors;
}
