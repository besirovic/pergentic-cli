export interface AgentCommand {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface Agent {
  name: string;
  buildCommand(prompt: string, workdir: string, options?: AgentOptions): AgentCommand;
  isInstalled(): Promise<boolean>;
}

export interface AgentOptions {
  instructions?: string;
  allowedTools?: string[];
  systemContext?: string;
  maxCostPerTask?: number;
}
