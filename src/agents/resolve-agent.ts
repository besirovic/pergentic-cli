import type { Agent } from "./types";
import { claudeCode } from "./claude-code";
import { codex } from "./codex";
import { aider } from "./aider";
import { opencode } from "./opencode";
import { mockAgent } from "./mock";

const agents: Record<string, Agent> = {
  "claude-code": claudeCode,
  codex,
  aider,
  opencode,
  mock: mockAgent,
};

export function resolveAgent(name: string): Agent {
  const agent = agents[name];
  if (!agent) {
    throw new Error(
      `Unknown agent: ${name}. Available: ${Object.keys(agents).join(", ")}`,
    );
  }
  return agent;
}

export { type Agent, type AgentCommand, type AgentOptions } from "./types";
