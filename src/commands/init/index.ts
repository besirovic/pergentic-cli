import { basename, resolve } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { select, Separator } from "@inquirer/prompts";
import chalk from "chalk";
import {
	loadProjectConfig,
	saveProjectConfig,
	loadProjectsRegistry,
	saveProjectsRegistry,
	ensureGlobalConfigDir,
} from "../../config/loader";
import { projectConfigPath, promptTemplatePath } from "../../config/paths";
import { ensureRepoClone } from "../../core/worktree";
import { extractSecrets, saveProjectEnv, migrateConfigSecrets } from "../../config/env";
import { DEFAULT_PROMPT_TEMPLATE } from "../../core/prompt-template-constants";
import { isExitPromptError, promptTheme } from "../../utils/prompt-helpers";
import { error } from "../../utils/ui";
import { ProjectConfigSchema, type ProjectConfig } from "../../config/schema";
import { clearScreen, printHeader, formatChoice, agentDisplayName, printSummary } from "./ui-helpers";
import { menuCategories } from "./integrations";
import {
	wizardStep1SelectAgents,
	wizardStep2SelectDefault,
	wizardStep3ConfigureKeys,
	wizardStepConfigureTools,
} from "./wizard-steps";
import {
	wizardStepConfigureLabels,
	wizardStepConfigureModelLabels,
	wizardStepConfigureVerification,
	wizardStepConfigureAgentRetry,
	maybeImportLegacyKeys,
} from "./wizard-steps-advanced";

function detectGitRemote(projectPath: string): { value: string | undefined; failed: boolean } {
	try {
		const value = execSync("git remote get-url origin", {
			cwd: projectPath,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return { value, failed: false };
	} catch (err) {
		console.debug("[pergentic] git remote detection failed:", err);
		return { value: undefined, failed: true };
	}
}

function detectGitBranch(projectPath: string): { value: string; failed: boolean } {
	try {
		const value = execSync("git symbolic-ref --short HEAD", {
			cwd: projectPath,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return { value, failed: false };
	} catch (err) {
		console.debug("[pergentic] git branch detection failed:", err);
		return { value: "main", failed: true };
	}
}

export async function init(projectPath?: string): Promise<void> {
	const absPath = resolve(projectPath ?? process.cwd());

	if (!existsSync(absPath)) {
		error(`Directory does not exist: ${absPath}`);
		return;
	}

	if (!existsSync(resolve(absPath, ".git"))) {
		error(`Not a git repository: ${absPath}`);
		return;
	}

	const { value: detectedRepo, failed: remoteFailed } = detectGitRemote(absPath);
	const { value: detectedBranch, failed: branchFailed } = detectGitBranch(absPath);
	const gitDetectionFailed = remoteFailed || branchFailed;

	const configFile = projectConfigPath(absPath);
	let config: ProjectConfig;
	if (existsSync(configFile)) {
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

	// Staging draft: collect all wizard changes here; only merge to config on successful completion
	const draft: ProjectConfig = structuredClone(config);

	// Handle Ctrl+C between prompts (SIGINT outside inquirer) to ensure clean exit without saving
	const onSigint = () => {
		clearScreen();
		console.log(chalk.dim("\n  Exited without saving.\n"));
		process.exit(0);
	};
	process.once("SIGINT", onSigint);

	try {
		// --- Wizard: Steps 1-3 (linear flow) ---
		clearScreen();
		printHeader();
		console.log(chalk.dim(`  Project: ${absPath}\n`));

		if (gitDetectionFailed) {
			console.log(
				chalk.yellow(`  ⚠ Git detection failed — defaults applied. Run with DEBUG=* for details.\n`)
			);
		}

		if (hasExisting) {
			console.log(
				chalk.dim("  Existing config loaded. Defaults pre-populated.\n")
			);
		}

		// Step 1: Select agents
		const selectedAgents = await wizardStep1SelectAgents(draft);
		draft.configuredAgents = selectedAgents;

		// Step 2: Select default agent
		const defaultAgent = await wizardStep2SelectDefault(selectedAgents, draft);
		draft.agent = defaultAgent;

		// Step 3: Configure API keys per agent
		await wizardStep3ConfigureKeys(selectedAgents, draft);

		// Step 4: Configure agent tools
		await wizardStepConfigureTools(selectedAgents, draft);

		// Step 5: Configure agent labels
		await wizardStepConfigureLabels(selectedAgents, draft);

		// Step 6: Configure model labels
		await wizardStepConfigureModelLabels(selectedAgents, draft);

		// Step 7: Configure verification commands
		await wizardStepConfigureVerification(draft);

		// Step 8: Configure agent execution retries
		await wizardStepConfigureAgentRetry(draft);

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
					name: formatChoice(cat, draft),
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
				await category.configure(draft);
			} catch (err: unknown) {
				if (isExitPromptError(err)) {
					// Ctrl+C during sub-flow returns to menu
				} else {
					throw err;
				}
			}
		}
	} catch (err: unknown) {
		process.removeListener("SIGINT", onSigint);
		if (isExitPromptError(err)) {
			clearScreen();
			console.log(chalk.dim("\n  Exited without saving.\n"));
			return;
		}
		throw err;
	}

	process.removeListener("SIGINT", onSigint);

	// Validate complete staged config before any writes
	const validation = ProjectConfigSchema.safeParse(draft);
	if (!validation.success) {
		error(`Config validation failed: ${validation.error.message}`);
		return;
	}
	const validatedConfig = validation.data;

	clearScreen();
	printHeader();

	printSummary(validatedConfig, menuCategories);

	// Extract secrets from config and write to .env file
	const { secrets, cleaned } = extractSecrets(validatedConfig);
	if (Object.keys(secrets).length > 0) {
		saveProjectEnv(absPath, secrets);
		console.log(`  ${chalk.green("✓")} Secrets saved to ${chalk.dim(".pergentic/.env")}`);
	}

	// Save project config without secrets
	saveProjectConfig(absPath, cleaned);

	// Create default prompt template if it doesn't exist
	const templateFilename = validatedConfig.promptTemplate?.path ?? "PROMPT.md";
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
	if (validatedConfig.repo) {
		const projectName = basename(absPath) || "project";
		try {
			console.log(`  ${chalk.dim("Cloning repo for task execution...")}`);
			await ensureRepoClone(projectName, validatedConfig.repo, validatedConfig.branch);
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
