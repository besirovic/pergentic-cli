import type { Agent, AgentCommand, AgentOptions } from "./types";
import { spawnAsync } from "../utils/process";

export const opencode: Agent = {
  name: "opencode",

  buildCommand(prompt: string, _workdir: string, _options?: AgentOptions): AgentCommand {
    return { command: "opencode", args: ["run", prompt] };
  },

  async isInstalled(): Promise<boolean> {
    try {
      const result = await spawnAsync("opencode", ["--version"], { timeout: 5000 });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  },
};
