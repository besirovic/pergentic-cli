export interface AgentCommand {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface AgentToolDef {
  name: string;
  description: string;
  default: boolean;
}

export interface Agent {
  name: string;
  tools: AgentToolDef[];
  buildCommand(prompt: string, workdir: string, options?: AgentOptions): AgentCommand;
  isInstalled(): Promise<boolean>;
}

export interface AgentOptions {
  instructions?: string;
  allowedTools?: string[];
  systemContext?: string;
  maxCostPerTask?: number;
  model?: string;
}
