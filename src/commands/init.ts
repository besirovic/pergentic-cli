import { resolve } from "node:path";
import { existsSync } from "node:fs";
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
} from "../config/loader";
import { projectConfigPath } from "../config/paths";
import { ensureRepoClone } from "../core/worktree";
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

const promptTheme = {
	prefix: { idle: chalk.cyan("?"), done: chalk.green("✓") },
	icon: { cursor: chalk.cyan("›") },
	style: {
		highlight: (text: string) => chalk.cyan.bold(text),
		message: (text: string) => chalk.bold(text),
	},
};

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

		// --- Step 4: Remaining integrations (menu-based) ---
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

	// Save project config
	saveProjectConfig(absPath, config);

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

function isExitPromptError(err: unknown): boolean {
	return (
		err instanceof Error &&
		(err.name === "ExitPromptError" ||
			err.constructor.name === "ExitPromptError")
	);
}

// --- Integration sub-flows (unchanged) ---

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
}
