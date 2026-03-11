import type { Agent, AgentCommand, AgentOptions, AgentToolDef } from "./types";
import { spawnAsync } from "../utils/process";
import { sanitizePrompt } from "./sanitize-prompt";

const VERSION_CHECK_TIMEOUT_MS = 5000;

export const CODEX_TOOLS: AgentToolDef[] = [
  { name: "shell", description: "Execute shell commands", default: true },
  { name: "file_read", description: "Read files", default: true },
  { name: "file_edit", description: "Edit existing files", default: true },
  { name: "file_write", description: "Create new files", default: true },
  { name: "web_search", description: "Search the web", default: false },
];

export const codex: Agent = {
  name: "codex",
  tools: CODEX_TOOLS,

  buildCommand(prompt: string, _workdir: string, options?: AgentOptions): AgentCommand {
    const tools = options?.allowedTools?.length
      ? options.allowedTools
      : CODEX_TOOLS.filter((t) => t.default).map((t) => t.name);

    const args = ["--quiet", sanitizePrompt(prompt)];

    if (tools.includes("shell") && tools.includes("file_edit") && tools.includes("file_write")) {
      args.push("--full-auto");
    } else if (tools.includes("file_edit") || tools.includes("file_write")) {
      args.push("--auto-edit");
    }

    if (options?.model) {
      args.push("--model", options.model);
    }

    const totalLength = args.reduce((sum, a) => sum + Buffer.byteLength(a), 0);
    if (totalLength > 64 * 1024) {
      throw new Error(
        `Agent command args exceed 64KB limit (${totalLength} bytes). Reduce prompt size before dispatching.`
      );
    }

    return { command: "codex", args };
  },

  async isInstalled(): Promise<boolean> {
    try {
      const result = await spawnAsync("codex", ["--version"], { timeout: VERSION_CHECK_TIMEOUT_MS });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  },
};
