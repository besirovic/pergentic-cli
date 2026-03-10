import { select, input, checkbox, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { resolveAgent } from "../../agents/resolve-agent";
import { promptTheme } from "../../utils/prompt-helpers";
import { error } from "../../utils/ui";
import type { ProjectConfig } from "../../config/schema";
import {
	PROVIDERS,
	FIXED_PROVIDERS,
	MULTI_PROVIDER_AGENTS,
	allAgents,
	AGENTS_WITH_TOOLS,
} from "./constants";
import type { AgentNameType, ApiProviderType, ProviderDef } from "./constants";
import { agentDisplayName, maskKey } from "./ui-helpers";

export async function wizardStep1SelectAgents(config: ProjectConfig): Promise<AgentNameType[]> {
	console.log(chalk.bold("  Step 1: Select Coding Agents\n"));

	const selected = await checkbox<AgentNameType>({
		message: "Which agents do you want to use?",
		choices: allAgents.map((a) => ({
			name: a.name,
			value: a.value,
			checked: config.configuredAgents.includes(a.value),
		})),
		validate: (items) =>
			items.length > 0 ? true : "Select at least one agent",
		theme: promptTheme,
	});

	return selected;
}

export async function wizardStep2SelectDefault(
	selectedAgents: AgentNameType[],
	config: ProjectConfig,
): Promise<AgentNameType> {
	if (selectedAgents.length === 1) {
		console.log(
			chalk.dim(`\n  Default agent: ${agentDisplayName(selectedAgents[0])} (only one selected)\n`)
		);
		return selectedAgents[0];
	}

	console.log(chalk.bold("\n  Step 2: Select Default Agent\n"));

	const defaultAgent = await select<AgentNameType>({
		message: "Which agent should be the default?",
		choices: selectedAgents.map((a) => ({
			name: agentDisplayName(a),
			value: a,
		})),
		default: selectedAgents.includes(config.agent) ? config.agent : undefined,
		theme: promptTheme,
	});

	return defaultAgent;
}

async function promptForApiKey(
	agent: AgentNameType,
	providerDef: ProviderDef,
	config: ProjectConfig,
): Promise<void> {
	const { keyField, prefix, label } = providerDef;
	if (!keyField) return;

	const existingKey = config[keyField];

	if (existingKey) {
		const reuse = await confirm({
			message: `Use existing ${label} key for ${agentDisplayName(agent)}? (${maskKey(existingKey)})`,
			default: true,
			theme: promptTheme,
		});
		if (reuse) {
			console.log();
			return;
		}
	}

	console.log();
	const key = await input({
		message: `${label} key for ${agentDisplayName(agent)}:`,
		default: existingKey,
		validate: (v) => {
			if (!prefix) return true;
			return v.startsWith(prefix) ? true : `Must start with ${prefix}`;
		},
		theme: promptTheme,
	});

	config[keyField] = key;
	console.log();
}

export async function wizardStep3ConfigureKeys(
	selectedAgents: AgentNameType[],
	config: ProjectConfig,
): Promise<void> {
	console.log(chalk.bold("\n  Step 3: Configure API Keys\n"));

	if (!config.agentProviders) {
		config.agentProviders = {};
	}

	for (const agent of selectedAgents) {
		const fixedProvider = FIXED_PROVIDERS[agent];

		if (fixedProvider) {
			const providerDef = PROVIDERS.find((p) => p.value === fixedProvider);
			if (!providerDef) {
				error(`Unknown provider: ${fixedProvider}`);
				return;
			}
			config.agentProviders[agent] = fixedProvider;
			await promptForApiKey(agent, providerDef, config);
		} else if (MULTI_PROVIDER_AGENTS.includes(agent)) {
			console.log(chalk.dim(`  ${agentDisplayName(agent)} supports multiple providers.`));

			const provider = await select<ApiProviderType>({
				message: `Which provider for ${agentDisplayName(agent)}?`,
				choices: PROVIDERS.map((p) => ({
					name: p.label,
					value: p.value,
				})),
				default: config.agentProviders[agent],
				theme: promptTheme,
			});

			config.agentProviders[agent] = provider;

			const providerDef = PROVIDERS.find((p) => p.value === provider);
			if (!providerDef) {
				error(`Unknown provider: ${provider}`);
				return;
			}
			if (providerDef.keyField) {
				await promptForApiKey(agent, providerDef, config);
			} else {
				console.log(
					chalk.dim(`\n  ${agentDisplayName(agent)} will use environment variables for API keys.\n`)
				);
			}
		}
	}
}

export async function wizardStepConfigureTools(
	selectedAgents: AgentNameType[],
	config: ProjectConfig,
): Promise<void> {
	const toolAgents = selectedAgents.filter((a) => AGENTS_WITH_TOOLS.includes(a));
	if (toolAgents.length === 0) return;

	console.log(chalk.bold("\n  Step 4: Configure Agent Tools\n"));

	if (!config.agentTools) {
		config.agentTools = {};
	}

	for (const agentName of toolAgents) {
		const agent = resolveAgent(agentName);
		if (agent.tools.length === 0) continue;

		const defaultTools = agent.tools.filter((t) => t.default).map((t) => t.name);
		const defaultLabel = defaultTools.length > 0
			? chalk.dim(` (${defaultTools.join(", ")})`)
			: "";

		const mode = await select<"default" | "custom">({
			message: `${agentDisplayName(agentName)} tools:`,
			choices: [
				{
					name: `Default${defaultLabel}`,
					value: "default" as const,
				},
				{
					name: "Custom (choose individually)",
					value: "custom" as const,
				},
			],
			theme: promptTheme,
		});

		if (mode === "default") {
			config.agentTools[agentName] = defaultTools;
			console.log(
				chalk.green(`  Using default tools for ${agentDisplayName(agentName)}\n`)
			);
		} else {
			const existingTools = config.agentTools[agentName] ?? defaultTools;

			const selected = await checkbox<string>({
				message: `Select tools for ${agentDisplayName(agentName)}:`,
				choices: agent.tools.map((t) => ({
					name: `${t.name.padEnd(16)} ${chalk.dim(t.description)}`,
					value: t.name,
					checked: existingTools.includes(t.name),
				})),
				validate: (items) =>
					items.length > 0 ? true : "Select at least one tool",
				theme: promptTheme,
			});

			config.agentTools[agentName] = selected;
			console.log(
				chalk.green(`  ${selected.length} tools enabled for ${agentDisplayName(agentName)}\n`)
			);
		}
	}
}

