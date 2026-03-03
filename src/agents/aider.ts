import type { Agent, AgentCommand, AgentOptions } from "./types";
import { spawnAsync } from "../utils/process";

export const aider: Agent = {
  name: "aider",
  tools: [],

  buildCommand(prompt: string, _workdir: string, _options?: AgentOptions): AgentCommand {
    return { command: "aider", args: ["--message", prompt, "--yes"] };
  },

  async isInstalled(): Promise<boolean> {
    try {
      const result = await spawnAsync("aider", ["--version"], { timeout: 5000 });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  },
};
