import type { Agent, AgentCommand, AgentOptions, AgentToolDef } from "./types";
import { spawnAsync } from "../utils/process";
import { sanitizePrompt } from "./sanitize-prompt";

const VERSION_CHECK_TIMEOUT_MS = 5000;

export const CLAUDE_CODE_TOOLS: AgentToolDef[] = [
  { name: "Edit", description: "Edit existing files", default: true },
  { name: "Write", description: "Create new files", default: true },
  { name: "Read", description: "Read files", default: true },
  { name: "Bash", description: "Execute shell commands", default: true },
  { name: "Glob", description: "Search for files by pattern", default: true },
  { name: "Grep", description: "Search file contents", default: true },
  { name: "WebFetch", description: "Fetch web content", default: true },
  { name: "WebSearch", description: "Search the web", default: true },
  { name: "NotebookEdit", description: "Edit Jupyter notebooks", default: false },
  { name: "Agent", description: "Launch sub-agents", default: false },
];

export const claudeCode: Agent = {
  name: "claude-code",
  tools: CLAUDE_CODE_TOOLS,

  buildCommand(prompt: string, workdir: string, options?: AgentOptions): AgentCommand {
    const args = ["-p", sanitizePrompt(prompt), "--output-format", "text"];

    const tools = options?.allowedTools?.length
      ? options.allowedTools
      : CLAUDE_CODE_TOOLS.filter((t) => t.default).map((t) => t.name);

    args.push("--allowedTools", tools.join(","));

    if (options?.model) {
      args.push("--model", options.model);
    }

    const totalLength = args.reduce((sum, a) => sum + a.length, 0);
    if (totalLength > 64 * 1024) {
      throw new Error(
        `Agent command args exceed 64KB limit (${totalLength} bytes). Reduce prompt size before dispatching.`
      );
    }

    return { command: "claude", args };
  },

  async isInstalled(): Promise<boolean> {
    try {
      const result = await spawnAsync("claude", ["--version"], { timeout: VERSION_CHECK_TIMEOUT_MS });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  },
};
