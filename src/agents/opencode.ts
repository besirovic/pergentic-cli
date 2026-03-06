import type { Agent, AgentCommand, AgentOptions, AgentToolDef } from "./types";
import { spawnAsync } from "../utils/process";

export const OPENCODE_TOOLS: AgentToolDef[] = [
  { name: "edit", description: "Edit existing files", default: true },
  { name: "write", description: "Create new files", default: true },
  { name: "read", description: "Read files", default: true },
  { name: "bash", description: "Execute shell commands", default: true },
  { name: "glob", description: "Search for files by pattern", default: true },
  { name: "grep", description: "Search file contents", default: true },
  { name: "web_fetch", description: "Fetch web content", default: false },
];

export const opencode: Agent = {
  name: "opencode",
  tools: OPENCODE_TOOLS,

  buildCommand(prompt: string, _workdir: string, options?: AgentOptions): AgentCommand {
    const tools = options?.allowedTools?.length
      ? options.allowedTools
      : OPENCODE_TOOLS.filter((t) => t.default).map((t) => t.name);

    const args = ["run", prompt];

    for (const tool of tools) {
      args.push("--tool", tool);
    }

    if (options?.model) {
      args.push("--model", options.model);
    }

    return { command: "opencode", args };
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
