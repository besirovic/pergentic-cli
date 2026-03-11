import type { Agent, AgentCommand, AgentOptions } from "./types";
import { spawnAsync } from "../utils/process";
import { sanitizePrompt } from "./sanitize-prompt";

const VERSION_CHECK_TIMEOUT_MS = 5000;

export const aider: Agent = {
  name: "aider",
  tools: [],

  buildCommand(prompt: string, _workdir: string, options?: AgentOptions): AgentCommand {
    const args = ["--message", sanitizePrompt(prompt), "--yes"];
    if (options?.model) {
      args.push("--model", options.model);
    }

    const totalLength = args.reduce((sum, a) => sum + Buffer.byteLength(a), 0);
    if (totalLength > 64 * 1024) {
      throw new Error(
        `Agent command args exceed 64KB limit (${totalLength} bytes). Reduce prompt size before dispatching.`
      );
    }

    return { command: "aider", args };
  },

  async isInstalled(): Promise<boolean> {
    try {
      const result = await spawnAsync("aider", ["--version"], { timeout: VERSION_CHECK_TIMEOUT_MS });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  },
};
