import type { Agent, AgentCommand, AgentOptions } from "./types";

export const mockAgent: Agent = {
  name: "mock",
  tools: [],

  buildCommand(prompt: string, _workdir: string, _options?: AgentOptions): AgentCommand {
    // Mock agent just echoes the prompt - useful for testing
    return { command: "echo", args: [prompt] };
  },

  async isInstalled(): Promise<boolean> {
    return true;
  },
};
