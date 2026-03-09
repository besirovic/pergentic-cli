import { resolve } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { select, input, checkbox, confirm, Separator } from "@inquirer/prompts";
import chalk from "chalk";
import {
	loadProjectConfig,
	saveProjectConfig,
	loadProjectsRegistry,
	saveProjectsRegistry,
	readRawGlobalConfig,
	ensureGlobalConfigDir,
	loadGlobalConfig,
} from "../config/loader";
import { projectConfigPath, promptTemplatePath } from "../config/paths";
import { ensureRepoClone } from "../core/worktree";
import { resolveAgent } from "../agents/resolve-agent";
import { extractSecrets, saveProjectEnv, migrateConfigSecrets } from "../config/env";
import { DEFAULT_PROMPT_TEMPLATE } from "../core/prompt-template-constants";
import type { ProjectConfig } from "../config/schema";

type AgentNameType = ProjectConfig["configuredAgents"][number];
type ApiProviderType = NonNullable<ProjectConfig["agentProviders"]>[AgentNameType];

// --- Provider definitions ---

interface ProviderDef {
	label: string;
	value: ApiProviderType;
	keyField: "anthropicApiKey" | "openaiApiKey" | "openrouterApiKey" | null;
	prefix: string | null;
}

const PROVIDERS: ProviderDef[] = [
	{ label: "Anthropic API", value: "anthropic", keyField: "anthropicApiKey", prefix: "sk-ant-" },
	{ label: "OpenAI API", value: "openai", keyField: "openaiApiKey", prefix: "sk-" },
	{ label: "OpenRouter", value: "openrouter", keyField: "openrouterApiKey", prefix: "sk-or-" },
	{ label: "Other (env-based)", value: "env", keyField: null, prefix: null },
];

// Fixed provider mappings for agents that only work with one provider
const FIXED_PROVIDERS: Partial<Record<AgentNameType, ApiProviderType>> = {
	"claude-code": "anthropic",
	codex: "openai",
};

// Agents that support multiple providers
const MULTI_PROVIDER_AGENTS: AgentNameType[] = ["aider", "opencode"];

// --- UI helpers ---

interface ToolCategory {
	id: string;
	label: string;
	isConfigured: (config: ProjectConfig) => boolean;
	configuredDetail?: (config: ProjectConfig) => string;
	configure: (config: ProjectConfig) => Promise<void>;
}

const menuCategories: ToolCategory[] = [
	{
		id: "github",
		label: "GitHub",
		isConfigured: (c) => !!c.githubToken,
		configure: configureGitHub,
	},
	{
		id: "linear",
		label: "Linear",
		isConfigured: (c) => !!c.linearApiKey,
		configure: configureLinear,
	},
	{
		id: "jira",
		label: "Jira",
		isConfigured: (c) => !!c.jiraDomain && !!c.jiraEmail && !!c.jiraApiToken,
		configure: configureJira,
	},
	{
		id: "slack",
		label: "Slack",
		isConfigured: (c) => !!c.slackBotToken && !!c.slackAppToken,
		configure: configureSlack,
	},
	{
		id: "notifications",
		label: "Notifications",
		isConfigured: (c) => {
			if (c.notifications?.slack?.webhook) return true;
			try {
				const g = loadGlobalConfig();
				return !!g.notifications?.slack?.webhook;
			} catch {
				return false;
			}
		},
		configure: configureNotifications,
	},
	{
		id: "project-settings",
		label: "Project Settings",
		isConfigured: () => true,
		configure: configureProjectSettings,
	},
];

function clearScreen(): void {
	process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
}

function printHeader(): void {
	const line = chalk.cyan("─".repeat(44));
	console.log();
	console.log(`  ${line}`);
	console.log(`  ${chalk.cyan("│")}${" ".repeat(42)}${chalk.cyan("│")}`);
	console.log(
		`  ${chalk.cyan("│")}   ${chalk.bold.white("PERGENTIC")}  ${chalk.dim(
			"Project Setup"
		)}${" ".repeat(13)}${chalk.cyan("│")}`
	);
	console.log(`  ${chalk.cyan("│")}${" ".repeat(42)}${chalk.cyan("│")}`);
	console.log(`  ${line}`);
	console.log();
}

const LABEL_WIDTH = 22;

function formatChoice(cat: ToolCategory, config: ProjectConfig): string {
	const configured = cat.isConfigured(config);
	const paddedLabel = cat.label.padEnd(LABEL_WIDTH);
	const label = configured ? chalk.white(paddedLabel) : chalk.dim(paddedLabel);
	const status = configured ? chalk.green("✓") : chalk.dim("○");
	const detail =
		configured && cat.configuredDetail
			? chalk.dim(` ${cat.configuredDetail(config)}`)
			: "";

	return `${label} ${status}${detail}`;
}

import { promptTheme, isExitPromptError } from "../utils/prompt-helpers";

function detectGitRemote(projectPath: string): string | undefined {
	try {
		return execSync("git remote get-url origin", {
			cwd: projectPath,
			encoding: "utf-8",
		}).trim();
	} catch {
		return undefined;
	}
}

function detectGitBranch(projectPath: string): string {
	try {
		return execSync("git symbolic-ref --short HEAD", {
			cwd: projectPath,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return "main";
	}
}

const LEGACY_KEY_FIELDS = [
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

async function maybeImportLegacyKeys(
	config: ProjectConfig,
): Promise<void> {
	let rawGlobal: Record<string, unknown>;
	try {
		rawGlobal = readRawGlobalConfig();
	} catch {
		return;
	}

	const legacyKeys = LEGACY_KEY_FIELDS.filter(
		(k) => rawGlobal[k] !== undefined && rawGlobal[k] !== "",
	);
	if (legacyKeys.length === 0) return;

	console.log(
		chalk.yellow(
			`  Found legacy API keys in global config: ${legacyKeys.join(", ")}`
		)
	);
	const importKeys = await confirm({
		message: "Import these into this project?",
		default: true,
		theme: promptTheme,
	});

	if (!importKeys) return;

	for (const key of legacyKeys) {
		const value = rawGlobal[key];
		if (value !== undefined) {
			(config as Record<string, unknown>)[key] = value;
		}
	}

	console.log(chalk.green("  Imported legacy keys into project config."));
	console.log();
}

// --- Agent display names ---

const allAgents: { name: string; value: AgentNameType }[] = [
	{ name: "Claude Code", value: "claude-code" },
	{ name: "Aider", value: "aider" },
	{ name: "Codex", value: "codex" },
	{ name: "OpenCode", value: "opencode" },
];

function agentDisplayName(agent: AgentNameType): string {
	return allAgents.find((a) => a.value === agent)?.name ?? agent;
}

function maskKey(key: string): string {
	if (key.length <= 10) return "***";
	return `${key.slice(0, 6)}***${key.slice(-4)}`;
}

// --- Wizard steps ---

async function wizardStep1SelectAgents(config: ProjectConfig): Promise<AgentNameType[]> {
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

async function wizardStep2SelectDefault(
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

async function wizardStep3ConfigureKeys(
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
			// Fixed-provider agent (claude-code → anthropic, codex → openai)
			const providerDef = PROVIDERS.find((p) => p.value === fixedProvider)!;
			config.agentProviders[agent] = fixedProvider;
			await promptForApiKey(agent, providerDef, config);
		} else if (MULTI_PROVIDER_AGENTS.includes(agent)) {
			// Multi-provider agent (aider, opencode)
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

			const providerDef = PROVIDERS.find((p) => p.value === provider)!;
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

async function promptForApiKey(
	agent: AgentNameType,
	providerDef: ProviderDef,
	config: ProjectConfig,
): Promise<void> {
	const { keyField, prefix, label } = providerDef;
	if (!keyField) return;

	const existingKey = config[keyField];

	// If key already exists (set by a previous agent in this session or from config), offer reuse
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

// --- Wizard step: Configure agent tools ---

const AGENTS_WITH_TOOLS: AgentNameType[] = ["claude-code", "codex", "opencode"];

async function wizardStepConfigureTools(
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

// --- Wizard step: Configure agent labels ---

async function wizardStepConfigureLabels(
	selectedAgents: AgentNameType[],
	config: ProjectConfig,
): Promise<void> {
	if (selectedAgents.length < 2) return;

	console.log(chalk.bold("\n  Step 5: Agent Labels\n"));
	console.log(
		chalk.dim("  Map ticket labels to agents. When a ticket has a matching")
	);
	console.log(
		chalk.dim("  label, that agent will execute it instead of the default.")
	);
	console.log(
		chalk.dim("  If multiple labels match different agents, all matched agents")
	);
	console.log(chalk.dim("  will execute the task and create separate PRs.\n"));

	const wantsLabels = await confirm({
		message: "Configure label-based agent routing?",
		default: false,
		theme: promptTheme,
	});

	if (!wantsLabels) return;

	if (!config.agentLabels) {
		config.agentLabels = {};
	}

	for (const agentName of selectedAgents) {
		const existing = config.agentLabels[agentName]?.join(", ") ?? "";
		const labelsStr = await input({
			message: `Labels for ${agentDisplayName(agentName)} (comma-separated):`,
			default: existing,
			theme: promptTheme,
		});

		const labels = labelsStr
			.split(",")
			.map((l) => l.trim())
			.filter(Boolean);

		if (labels.length > 0) {
			config.agentLabels[agentName] = labels;
		} else {
			delete config.agentLabels[agentName];
		}
	}

	const configured = Object.entries(config.agentLabels).filter(
		([, labels]) => labels.length > 0
	);
	if (configured.length > 0) {
		console.log(chalk.green(`\n  Label routing configured for ${configured.length} agent(s).\n`));
	} else {
		delete config.agentLabels;
		console.log(chalk.dim("\n  No labels configured. Default agent will handle all tasks.\n"));
	}
}

// --- Wizard step: Configure model labels ---

async function wizardStepConfigureModelLabels(
	selectedAgents: AgentNameType[],
	config: ProjectConfig,
): Promise<void> {
	if (selectedAgents.length === 0) return;

	console.log(chalk.bold("\n  Step 6: Model Labels\n"));
	console.log(
		chalk.dim("  Map ticket labels to specific models. When a ticket has a matching")
	);
	console.log(
		chalk.dim("  label, the agent will use that model instead of its default.")
	);
	console.log(
		chalk.dim("  Model labels implicitly select their agent (no agent label needed).\n")
	);

	const wantsModelLabels = await confirm({
		message: "Configure model label routing?",
		default: false,
		theme: promptTheme,
	});

	if (!wantsModelLabels) return;

	if (!config.modelLabels) {
		config.modelLabels = {};
	}

	for (const agentName of selectedAgents) {
		console.log(chalk.dim(`\n  ${agentDisplayName(agentName)}:`));

		const existingLabels = config.modelLabels[agentName] ?? {};
		let collecting = true;

		const labelModelPairs: Record<string, string> = { ...existingLabels };

		if (Object.keys(existingLabels).length > 0) {
			console.log(chalk.dim(`  Existing: ${Object.entries(existingLabels).map(([l, m]) => `${l}→${m}`).join(", ")}`));
		}

		while (collecting) {
			const labelName = await input({
				message: `Label name for ${agentDisplayName(agentName)} (or empty to finish):`,
				theme: promptTheme,
			});

			if (labelName.trim() === "") {
				collecting = false;
			} else {
				const modelId = await input({
					message: `Model ID for label "${labelName.trim()}":`,
					validate: (v) => (v.trim().length > 0 ? true : "Model ID is required"),
					theme: promptTheme,
				});

				labelModelPairs[labelName.trim()] = modelId.trim();
				console.log(chalk.green(`  Added: ${labelName.trim()} → ${modelId.trim()}`));
			}
		}

		if (Object.keys(labelModelPairs).length > 0) {
			config.modelLabels[agentName] = labelModelPairs;
		} else {
			delete config.modelLabels[agentName];
		}
	}

	const configured = Object.entries(config.modelLabels).filter(
		([, labels]) => Object.keys(labels).length > 0
	);
	if (configured.length > 0) {
		console.log(chalk.green(`\n  Model label routing configured for ${configured.length} agent(s).\n`));
	} else {
		delete config.modelLabels;
		console.log(chalk.dim("\n  No model labels configured.\n"));
	}
}

// --- Wizard step: Configure verification commands ---

async function wizardStepConfigureVerification(
	config: ProjectConfig,
): Promise<void> {
	console.log(chalk.bold("\n  Step 7: Verification Commands\n"));

	const wantsVerification = await confirm({
		message: "Do you want to configure verification commands?",
		default: false,
		theme: promptTheme,
	});

	if (!wantsVerification) return;

	console.log(
		chalk.dim(
			"\n  Verification commands run sequentially after the coding agent completes."
		)
	);
	console.log(
		chalk.dim(
			"  If a command fails, the agent is re-invoked to fix the issue.\n"
		)
	);

	const commands: string[] = [];
	let collecting = true;

	while (collecting) {
		const cmd = await input({
			message: commands.length === 0
				? "Enter a verification command:"
				: "Enter another command (or leave empty to finish):",
			validate: (v) => {
				if (commands.length === 0 && v.trim() === "") {
					return "At least one command is required";
				}
				return true;
			},
			theme: promptTheme,
		});

		if (cmd.trim() === "") {
			collecting = false;
		} else {
			commands.push(cmd.trim());
			console.log(chalk.green(`  Added: ${cmd.trim()}`));
		}
	}

	const maxRetriesStr = await input({
		message: "Max retries for fixing verification failures:",
		default: "3",
		validate: (v) => {
			const n = Number(v);
			if (Number.isNaN(n) || !Number.isInteger(n) || n < 0 || n > 20) {
				return "Must be an integer between 0 and 20";
			}
			return true;
		},
		theme: promptTheme,
	});

	config.verification = {
		commands,
		maxRetries: Number(maxRetriesStr),
	};

	console.log(
		chalk.green(`\n  ${commands.length} verification command(s) configured.\n`)
	);
}

// --- Wizard step: Configure agent execution retries ---

async function wizardStepConfigureAgentRetry(
	config: ProjectConfig,
): Promise<void> {
	console.log(chalk.bold("\n  Step 8: Agent Execution Retries\n"));
	console.log(
		chalk.dim("  If a coding agent crashes or exits with an error,")
	);
	console.log(
		chalk.dim("  automatic retries can be attempted with exponential backoff.\n")
	);

	const existing = config.agentRetry;

	const wantsRetry = await confirm({
		message: "Enable automatic retry on agent failure?",
		default: !!existing?.maxRetries,
		theme: promptTheme,
	});

	if (!wantsRetry) {
		config.agentRetry = undefined;
		return;
	}

	const maxRetriesStr = await input({
		message: "Max retry attempts:",
		default: String(existing?.maxRetries ?? 2),
		validate: (v) => {
			const n = Number(v);
			if (Number.isNaN(n) || !Number.isInteger(n) || n < 1 || n > 10) {
				return "Must be an integer between 1 and 10";
			}
			return true;
		},
		theme: promptTheme,
	});

	const baseDelayStr = await input({
		message: "Base delay between retries (seconds):",
		default: String(existing?.baseDelaySeconds ?? 30),
		validate: (v) => {
			const n = Number(v);
			if (Number.isNaN(n) || !Number.isInteger(n) || n < 1 || n > 300) {
				return "Must be an integer between 1 and 300";
			}
			return true;
		},
		theme: promptTheme,
	});

	config.agentRetry = {
		maxRetries: Number(maxRetriesStr),
		baseDelaySeconds: Number(baseDelayStr),
	};

	console.log(
		chalk.green(`\n  Agent retry configured: ${maxRetriesStr} retries, ${baseDelayStr}s base delay.\n`)
	);
}

// --- Main init function ---

export async function init(projectPath?: string): Promise<void> {
	const absPath = resolve(projectPath ?? process.cwd());

	if (!existsSync(absPath)) {
		console.error(`Error: Directory does not exist: ${absPath}`);
		process.exitCode = 1;
		return;
	}

	if (!existsSync(resolve(absPath, ".git"))) {
		console.error(`Error: Not a git repository: ${absPath}`);
		process.exitCode = 1;
		return;
	}

	const detectedRepo = detectGitRemote(absPath);
	const detectedBranch = detectGitBranch(absPath);

	const configFile = projectConfigPath(absPath);
	let config: ProjectConfig;
	if (existsSync(configFile)) {
		// Migrate any hardcoded secrets from config.yaml to .env
		const migration = migrateConfigSecrets(absPath);
		if (migration.migrated) {
			console.log(
				chalk.green(`  Migrated ${migration.fields.length} secret(s) from config.yaml to .pergentic/.env`)
			);
			console.log();
		}
		config = loadProjectConfig(absPath);
	} else {
		config = {
			repo: detectedRepo ?? "",
			branch: detectedBranch,
			agent: "claude-code",
			configuredAgents: [],
		};
	}

	await maybeImportLegacyKeys(config);

	const hasExisting = existsSync(configFile);

	try {
		// --- Wizard: Steps 1-3 (linear flow) ---
		clearScreen();
		printHeader();
		console.log(chalk.dim(`  Project: ${absPath}\n`));

		if (hasExisting) {
			console.log(
				chalk.dim("  Existing config loaded. Defaults pre-populated.\n")
			);
		}

		// Step 1: Select agents
		const selectedAgents = await wizardStep1SelectAgents(config);
		config.configuredAgents = selectedAgents;

		// Step 2: Select default agent
		const defaultAgent = await wizardStep2SelectDefault(selectedAgents, config);
		config.agent = defaultAgent;

		// Step 3: Configure API keys per agent
		await wizardStep3ConfigureKeys(selectedAgents, config);

		// Step 4: Configure agent tools
		await wizardStepConfigureTools(selectedAgents, config);

		// Step 5: Configure agent labels
		await wizardStepConfigureLabels(selectedAgents, config);

		// Step 6: Configure model labels
		await wizardStepConfigureModelLabels(selectedAgents, config);

		// Step 7: Configure verification commands
		await wizardStepConfigureVerification(config);

		// Step 8: Configure agent execution retries
		await wizardStepConfigureAgentRetry(config);

		// --- Step 9: Remaining integrations (menu-based) ---
		let continueMenu = true;
		while (continueMenu) {
			clearScreen();
			printHeader();

			console.log(
				chalk.dim(`  Project: ${absPath}`)
			);
			console.log(
				chalk.green(`  Agents: ${selectedAgents.map(agentDisplayName).join(", ")}`)
			);
			console.log(
				chalk.green(`  Default: ${agentDisplayName(defaultAgent)}\n`)
			);

			const choices = [
				...menuCategories.map((cat) => ({
					name: formatChoice(cat, config),
					value: cat.id,
				})),
				new Separator(chalk.dim("──────────────────────────────────────")),
				{ name: `${chalk.bold.white("Save and exit")}`, value: "done" },
			];

			const selected = await select({
				message: "Configure integrations (optional):",
				choices,
				loop: false,
				theme: promptTheme,
			});

			if (selected === "done") {
				continueMenu = false;
				break;
			}

			const category = menuCategories.find((c) => c.id === selected);
			if (!category) continue;

			try {
				clearScreen();
				console.log();
				console.log(`  ${chalk.cyan("─")} ${chalk.bold(category.label)}`);
				console.log();
				await category.configure(config);
			} catch (err: unknown) {
				if (isExitPromptError(err)) {
					// Ctrl+C during sub-flow returns to menu
				} else {
					throw err;
				}
			}
		}
	} catch (err: unknown) {
		if (isExitPromptError(err)) {
			clearScreen();
			console.log(chalk.dim("\n  Exited without saving.\n"));
			return;
		}
		throw err;
	}

	clearScreen();
	printHeader();

	// Summary
	console.log(`  ${chalk.green("✓")} Agents: ${chalk.white(config.configuredAgents.map(agentDisplayName).join(", "))}`);
	console.log(`  ${chalk.green("✓")} Default: ${chalk.white(agentDisplayName(config.agent))}`);

	if (config.agentTools) {
		for (const [agentName, tools] of Object.entries(config.agentTools)) {
			if (tools.length > 0) {
				console.log(
					`  ${chalk.green("✓")} ${agentDisplayName(agentName as AgentNameType)} tools: ${chalk.white(tools.join(", "))}`
				);
			}
		}
	}

	if (config.agentLabels) {
		for (const [agentName, labels] of Object.entries(config.agentLabels)) {
			if (labels.length > 0) {
				console.log(
					`  ${chalk.green("✓")} ${agentDisplayName(agentName as AgentNameType)} labels: ${chalk.white(labels.join(", "))}`
				);
			}
		}
	}

	if (config.modelLabels) {
		for (const [agentName, labelMap] of Object.entries(config.modelLabels)) {
			const entries = Object.entries(labelMap);
			if (entries.length > 0) {
				const display = entries.map(([l, m]) => `${l}→${m}`).join(", ");
				console.log(
					`  ${chalk.green("✓")} ${agentDisplayName(agentName as AgentNameType)} model labels: ${chalk.white(display)}`
				);
			}
		}
	}

	if (config.verification?.commands?.length) {
		console.log(`  ${chalk.green("✓")} Verification: ${chalk.white(config.verification.commands.join(" → "))}`);
		console.log(`  ${chalk.green("✓")} Max retries: ${chalk.white(String(config.verification.maxRetries))}`);
	}

	if (config.agentRetry?.maxRetries) {
		console.log(`  ${chalk.green("✓")} Agent retry: ${chalk.white(`${config.agentRetry.maxRetries} retries, ${config.agentRetry.baseDelaySeconds}s base delay`)}`);
	}

	if (config.branching?.template && config.branching.template !== "{taskId}-{title}") {
		console.log(`  ${chalk.green("✓")} Branch template: ${chalk.white(config.branching.template)}`);
	}

	const configuredIntegrations = menuCategories.filter(
		(c) => c.isConfigured(config) && c.id !== "project-settings"
	);
	const unconfiguredIntegrations = menuCategories.filter(
		(c) => !c.isConfigured(config) && c.id !== "project-settings"
	);

	if (configuredIntegrations.length > 0) {
		console.log(
			`  ${chalk.green("✓")} Integrations: ${chalk.white(
				configuredIntegrations.map((c) => c.label).join(", ")
			)}`
		);
	}
	if (unconfiguredIntegrations.length > 0) {
		console.log(
			`  ${chalk.dim("○")} Skipped: ${chalk.dim(
				unconfiguredIntegrations.map((c) => c.label).join(", ")
			)}`
		);
	}
	console.log();

	// Extract secrets from config and write to .env file
	const { secrets, cleaned } = extractSecrets(config as unknown as Record<string, unknown>);
	if (Object.keys(secrets).length > 0) {
		saveProjectEnv(absPath, secrets);
		console.log(`  ${chalk.green("✓")} Secrets saved to ${chalk.dim(".pergentic/.env")}`);
	}

	// Save project config without secrets
	saveProjectConfig(absPath, cleaned as unknown as ProjectConfig);

	// Create default prompt template if it doesn't exist
	const templateFilename = config.promptTemplate?.path ?? "PROMPT.md";
	const templateFile = promptTemplatePath(absPath, templateFilename);
	if (!existsSync(templateFile)) {
		writeFileSync(templateFile, DEFAULT_PROMPT_TEMPLATE);
		console.log(`  ${chalk.green("✓")} Prompt template created at ${chalk.dim(`.pergentic/${templateFilename}`)}`);
	} else {
		console.log(`  ${chalk.dim("○")} Prompt template already exists, skipping`);
	}

	// Register in projects registry
	ensureGlobalConfigDir();
	const registry = loadProjectsRegistry();
	if (!registry.projects.some((p) => resolve(p.path) === absPath)) {
		registry.projects.push({ path: absPath });
		saveProjectsRegistry(registry);
	}

	// Clone repo into workspaces dir for worktree-based task execution
	if (config.repo) {
		const projectName = absPath.split("/").pop() ?? "project";
		try {
			console.log(`  ${chalk.dim("Cloning repo for task execution...")}`);
			await ensureRepoClone(projectName, config.repo, config.branch);
			console.log(`  ${chalk.green("✓")} Repo cloned for worktree use`);
		} catch (err) {
			console.log(
				`  ${chalk.yellow("⚠")} Failed to clone repo: ${err instanceof Error ? err.message : err}`
			);
			console.log(
				`  ${chalk.dim("  The daemon will not be able to create worktrees until this is resolved.")}`
			);
		}
	}

	console.log(`  ${chalk.green("Config saved to")} ${configFile}`);
	console.log();
	console.log(`  Next steps:`);
	console.log(
		`  ${chalk.dim("$")} ${chalk.cyan("pergentic start")}    Start the daemon`
	);
	console.log();
}

// --- Integration sub-flows ---

async function configureGitHub(config: ProjectConfig): Promise<void> {
	config.githubToken = await input({
		message: "GitHub token:",
		default: config.githubToken,
		validate: (v) =>
			v.startsWith("ghp_") || v.startsWith("github_pat_")
				? true
				: "Must start with ghp_ or github_pat_",
		theme: promptTheme,
	});
}

async function configureLinear(config: ProjectConfig): Promise<void> {
	config.linearApiKey = await input({
		message: "Linear API key:",
		default: config.linearApiKey,
		validate: (v) =>
			v.startsWith("lin_api_") ? true : "Must start with lin_api_",
		theme: promptTheme,
	});

	console.log();
	config.linearTeamId = await input({
		message: "Linear team ID (e.g., PROJ):",
		default: config.linearTeamId,
		validate: (v) => (v.length > 0 ? true : "Required"),
		theme: promptTheme,
	});
}

async function configureJira(config: ProjectConfig): Promise<void> {
	config.jiraDomain = await input({
		message: "Jira domain (e.g. mycompany.atlassian.net):",
		default: config.jiraDomain,
		validate: (v) => (v.length > 0 ? true : "Required"),
		theme: promptTheme,
	});

	console.log();
	config.jiraEmail = await input({
		message: "Jira email:",
		default: config.jiraEmail,
		validate: (v) => (v.includes("@") ? true : "Must be a valid email"),
		theme: promptTheme,
	});

	console.log();
	config.jiraApiToken = await input({
		message: "Jira API token:",
		default: config.jiraApiToken,
		validate: (v) => (v.length > 0 ? true : "Required"),
		theme: promptTheme,
	});
}

async function configureSlack(config: ProjectConfig): Promise<void> {
	config.slackBotToken = await input({
		message: "Slack Bot Token:",
		default: config.slackBotToken,
		validate: (v) => (v.startsWith("xoxb-") ? true : "Must start with xoxb-"),
		theme: promptTheme,
	});

	console.log();
	config.slackAppToken = await input({
		message: "Slack App Token:",
		default: config.slackAppToken,
		validate: (v) => (v.startsWith("xapp-") ? true : "Must start with xapp-"),
		theme: promptTheme,
	});
}

async function configureNotifications(config: ProjectConfig): Promise<void> {
	const existingWebhook = config.notifications?.slack?.webhook
		?? loadGlobalConfig().notifications?.slack?.webhook;

	const webhook = await input({
		message: "Slack webhook URL:",
		default: existingWebhook,
		validate: (v) =>
			v.startsWith("https://hooks.slack.com/")
				? true
				: "Must start with https://hooks.slack.com/",
		theme: promptTheme,
	});

	console.log();
	const existingOn = config.notifications?.slack?.on;
	const events = await checkbox<string>({
		message: "Which events should send Slack notifications?",
		choices: [
			{ name: "PR Created", value: "prCreated", checked: existingOn?.prCreated ?? true },
			{ name: "Task Failed", value: "taskFailed", checked: existingOn?.taskFailed ?? true },
			{ name: "Task Completed", value: "taskCompleted", checked: existingOn?.taskCompleted ?? false },
		],
		theme: promptTheme,
	});

	if (!config.notifications) {
		config.notifications = {};
	}
	config.notifications.slack = {
		webhook,
		on: {
			prCreated: events.includes("prCreated"),
			taskFailed: events.includes("taskFailed"),
			taskCompleted: events.includes("taskCompleted"),
		},
	};

	console.log(chalk.green("  Slack notifications configured.\n"));
}

async function configureProjectSettings(config: ProjectConfig): Promise<void> {
	config.repo = await input({
		message: "Repository URL:",
		default: config.repo,
		validate: (v) => (v.length > 0 ? true : "Required"),
		theme: promptTheme,
	});

	console.log();
	config.branch = await input({
		message: "Default branch:",
		default: config.branch,
		theme: promptTheme,
	});

	console.log();
	const wantsBranchTemplate = await confirm({
		message: "Configure branch naming template?",
		default: false,
		theme: promptTheme,
	});

	if (wantsBranchTemplate) {
		console.log(chalk.dim("\n  Available variables:"));
		console.log(chalk.dim("    {taskId}     - Provider task ID (e.g. LIN-123)"));
		console.log(chalk.dim("    {title}      - Slugified task title"));
		console.log(chalk.dim("    {source}     - Task origin (linear, github, slack, schedule)"));
		console.log(chalk.dim("    {type}       - Conventional commit type from labels (feat, fix, chore, etc.)"));
		console.log(chalk.dim("    {project}    - Project name"));
		console.log(chalk.dim("    {agent}      - Coding agent name"));
		console.log(chalk.dim("    {date}       - ISO date (YYYY-MM-DD)"));
		console.log(chalk.dim("    {timestamp}  - Unix timestamp"));
		console.log(chalk.dim("    {shortHash}  - 7-char hash of title"));
		console.log(chalk.dim("  Template must contain {taskId} for uniqueness.\n"));

		const template = await input({
			message: "Branch template:",
			default: config.branching?.template ?? "{taskId}-{title}",
			validate: (v) => v.includes("{taskId}") ? true : "Must contain {taskId}",
			theme: promptTheme,
		});

		if (!config.branching) {
			config.branching = { template };
		} else {
			config.branching.template = template;
		}

		if (template.includes("{type}")) {
			const wantsTypeMap = await confirm({
				message: "Customize label-to-type mapping? (default maps 'bug'\u2192fix, 'feature'\u2192feat, etc.)",
				default: false,
				theme: promptTheme,
			});

			if (wantsTypeMap) {
				const typeMap: Record<string, string[]> = { ...(config.branching?.typeMap ?? {}) };
				let collecting = true;

				if (Object.keys(typeMap).length > 0) {
					console.log(chalk.dim(`  Existing: ${Object.entries(typeMap).map(([t, ls]) => `${t}\u2192${ls.join(",")}`).join("  ")}`));
				}

				while (collecting) {
					const rawTypeName = await input({
						message: "Conventional type (e.g. feat, fix, chore) or empty to finish:",
						theme: promptTheme,
					});

					const typeName = rawTypeName.trim();
					if (typeName === "") {
						collecting = false;
					} else {
						const labelsStr = await input({
							message: `Labels that map to "${typeName}" (comma-separated):`,
							default: typeMap[typeName]?.join(", ") ?? "",
							validate: (v) => v.trim().length > 0 ? true : "At least one label is required",
							theme: promptTheme,
						});

						const labels = labelsStr.split(",").map((l) => l.trim()).filter(Boolean);
						typeMap[typeName] = labels;
						console.log(chalk.green(`  Added: ${typeName} \u2190 ${labels.join(", ")}`));
					}
				}

				if (Object.keys(typeMap).length > 0) {
					config.branching!.typeMap = typeMap;
				}
			}
		}
	}
}
