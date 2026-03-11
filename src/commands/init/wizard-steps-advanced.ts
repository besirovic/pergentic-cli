import { input, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { readRawGlobalConfig } from "../../config/loader";
import { promptTheme } from "../../utils/prompt-helpers";
import { ProjectConfigSchema, type ProjectConfig } from "../../config/schema";
import { LEGACY_KEY_FIELDS } from "./constants";
import type { AgentNameType } from "./constants";
import { agentDisplayName } from "./ui-helpers";

export async function wizardStepConfigureLabels(
	selectedAgents: AgentNameType[],
	config: ProjectConfig,
): Promise<void> {
	if (selectedAgents.length < 2) return;

	console.log(chalk.bold("\n  Step 5: Agent Labels\n"));
	console.log(chalk.dim("  Map ticket labels to agents. When a ticket has a matching"));
	console.log(chalk.dim("  label, that agent will execute it instead of the default."));
	console.log(chalk.dim("  If multiple labels match different agents, all matched agents"));
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

export async function wizardStepConfigureModelLabels(
	selectedAgents: AgentNameType[],
	config: ProjectConfig,
): Promise<void> {
	if (selectedAgents.length === 0) return;

	console.log(chalk.bold("\n  Step 6: Model Labels\n"));
	console.log(chalk.dim("  Map ticket labels to specific models. When a ticket has a matching"));
	console.log(chalk.dim("  label, the agent will use that model instead of its default."));
	console.log(chalk.dim("  Model labels implicitly select their agent (no agent label needed).\n"));

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

export async function wizardStepConfigureVerification(
	config: ProjectConfig,
): Promise<void> {
	console.log(chalk.bold("\n  Step 7: Verification Commands\n"));

	const wantsVerification = await confirm({
		message: "Do you want to configure verification commands?",
		default: false,
		theme: promptTheme,
	});

	if (!wantsVerification) return;

	console.log(chalk.dim("\n  Verification commands run sequentially after the coding agent completes."));
	console.log(chalk.dim("  If a command fails, the agent is re-invoked to fix the issue.\n"));

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
		commandTimeout: 300,
	};

	console.log(
		chalk.green(`\n  ${commands.length} verification command(s) configured.\n`)
	);
}

export async function wizardStepConfigureAgentRetry(
	config: ProjectConfig,
): Promise<void> {
	console.log(chalk.bold("\n  Step 8: Agent Execution Retries\n"));
	console.log(chalk.dim("  If a coding agent crashes or exits with an error,"));
	console.log(chalk.dim("  automatic retries can be attempted with exponential backoff.\n"));

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

export async function maybeImportLegacyKeys(
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
		if (value === undefined) continue;
		const fieldSchema = ProjectConfigSchema.shape[key];
		const parsed = fieldSchema.safeParse(value);
		if (!parsed.success) continue;
		Object.assign(config, { [key]: parsed.data });
	}

	console.log(chalk.green("  Imported legacy keys into project config."));
	console.log();
}
