import type { Agent, AgentCommand, AgentOptions } from "./types";
import { spawnAsync } from "../utils/process";

export const codex: Agent = {
  name: "codex",

  buildCommand(prompt: string, _workdir: string, _options?: AgentOptions): AgentCommand {
    return { command: "codex", args: ["--quiet", prompt] };
  },

  async isInstalled(): Promise<boolean> {
    try {
      const result = await spawnAsync("codex", ["--version"], { timeout: 5000 });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  },
};
