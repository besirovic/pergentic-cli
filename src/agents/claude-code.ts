import type { Agent, AgentCommand, AgentOptions } from "./types";
import { spawnAsync } from "../utils/process";

export const claudeCode: Agent = {
  name: "claude-code",

  buildCommand(prompt: string, workdir: string, options?: AgentOptions): AgentCommand {
    const args = ["-p", prompt, "--output-format", "text"];

    if (options?.allowedTools?.length) {
      args.push("--allowedTools", options.allowedTools.join(","));
    }

    return { command: "claude", args };
  },

  async isInstalled(): Promise<boolean> {
    try {
      const result = await spawnAsync("claude", ["--version"], { timeout: 5000 });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  },
};
