import type { ProjectConfig } from "../../config/schema";

export type AgentNameType = ProjectConfig["configuredAgents"][number];
export type ApiProviderType = NonNullable<ProjectConfig["agentProviders"]>[AgentNameType];

// --- Provider definitions ---

export interface ProviderDef {
	label: string;
	value: ApiProviderType;
	keyField: "anthropicApiKey" | "openaiApiKey" | "openrouterApiKey" | null;
	prefix: string | null;
}

export const PROVIDERS: ProviderDef[] = [
	{ label: "Anthropic API", value: "anthropic", keyField: "anthropicApiKey", prefix: "sk-ant-" },
	{ label: "OpenAI API", value: "openai", keyField: "openaiApiKey", prefix: "sk-" },
	{ label: "OpenRouter", value: "openrouter", keyField: "openrouterApiKey", prefix: "sk-or-" },
	{ label: "Other (env-based)", value: "env", keyField: null, prefix: null },
];

// Fixed provider mappings for agents that only work with one provider
export const FIXED_PROVIDERS: Partial<Record<AgentNameType, ApiProviderType>> = {
	"claude-code": "anthropic",
	codex: "openai",
};

// Agents that support multiple providers
export const MULTI_PROVIDER_AGENTS: AgentNameType[] = ["aider", "opencode"];

export const allAgents: { name: string; value: AgentNameType }[] = [
	{ name: "Claude Code", value: "claude-code" },
	{ name: "Aider", value: "aider" },
	{ name: "Codex", value: "codex" },
	{ name: "OpenCode", value: "opencode" },
];

const VALID_AGENT_NAMES = new Set<string>(allAgents.map((a) => a.value));

export function isValidAgentName(name: string): name is AgentNameType {
	return VALID_AGENT_NAMES.has(name);
}

export const LEGACY_KEY_FIELDS = [
	"anthropicApiKey",
	"openaiApiKey",
	"openrouterApiKey",
	"githubToken",
	"linearApiKey",
	"slackBotToken",
	"slackAppToken",
	"jiraDomain",
	"jiraEmail",
	"jiraApiToken",
	"configuredAgents",
	"agentProviders",
] as const;

export const AGENTS_WITH_TOOLS: AgentNameType[] = ["claude-code", "codex", "opencode"];
