import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { select, input } from "@inquirer/prompts";
import chalk from "chalk";
import {
	loadSchedulesConfig,
	addScheduleEntry,
	removeScheduleEntry,
	setScheduleEnabled,
	ensureSchedulesDir,
	writePromptFile,
	PROMPT_TEMPLATE,
} from "../config/schedules";
import { loadProjectConfig } from "../config/loader";
import type { ScheduleEntry } from "../config/schema";
import { promptTheme, isExitPromptError } from "../utils/prompt-helpers";

const CRON_PRESETS = [
	{ name: "Every 15 minutes", value: "*/15 * * * *" },
	{ name: "Every 30 minutes", value: "*/30 * * * *" },
	{ name: "Hourly", value: "0 * * * *" },
	{ name: "Every 6 hours", value: "0 */6 * * *" },
	{ name: "Daily at midnight", value: "0 0 * * *" },
	{ name: "Daily at 2am", value: "0 2 * * *" },
	{ name: "Weekly Mon 9am", value: "0 9 * * 1" },
	{ name: "Custom cron...", value: "custom" },
];

export async function scheduleAdd(projectPath: string): Promise<void> {
	try {
		const projectConfig = loadProjectConfig(projectPath);
		const existing = loadSchedulesConfig(projectPath);

		// Name
		const name = await input({
			message: "Schedule name (slug):",
			validate: (v) => {
				if (!/^[a-z0-9-]+$/.test(v)) return "Must be lowercase alphanumeric with hyphens";
				if (existing.schedules.some((s) => s.name === v)) return "A schedule with this name already exists";
				return true;
			},
			theme: promptTheme,
		});

		// Cron
		let cron = await select({
			message: "Schedule:",
			choices: CRON_PRESETS.map((p) => ({
				name: `${p.name}${p.value !== "custom" ? chalk.dim(` (${p.value})`) : ""}`,
				value: p.value,
			})),
			theme: promptTheme,
		});

		if (cron === "custom") {
			cron = await input({
				message: "Cron expression (5 fields):",
				validate: (v) => {
					const parts = v.trim().split(/\s+/);
					if (parts.length !== 5) return "Must be a 5-field cron expression";
					return true;
				},
				theme: promptTheme,
			});
		}

		// Type
		const type = await select<"prompt" | "command">({
			message: "Task type:",
			choices: [
				{ name: "Prompt (send to coding agent)", value: "prompt" },
				{ name: "Command (run shell command)", value: "command" },
			],
			theme: promptTheme,
		});

		let promptPath: string | undefined;
		let command: string | undefined;
		let agent: ScheduleEntry["agent"] | undefined;

		if (type === "prompt") {
			const relativePath = `schedules/${name}.md`;
			promptPath = relativePath;
			ensureSchedulesDir(projectPath);
			writePromptFile(projectPath, relativePath, PROMPT_TEMPLATE(name));

			const editChoice = await select({
				message: "Prompt file:",
				choices: [
					{ name: "Open in editor now", value: "edit" },
					{ name: "I'll fill it in later", value: "later" },
				],
				theme: promptTheme,
			});

			if (editChoice === "edit") {
				const { schedulePromptPath } = await import("../config/paths.js");
				const fullPath = schedulePromptPath(projectPath, relativePath);
				const editor = process.env.EDITOR || "vi";
				await new Promise<void>((resolve) => {
					const child = spawn(editor, [fullPath], { stdio: "inherit" });
					child.on("close", () => resolve());
				});
			} else {
				const { schedulePromptPath } = await import("../config/paths.js");
				const fullPath = schedulePromptPath(projectPath, relativePath);
				console.log(chalk.dim(`\n  Edit prompt at: ${fullPath}\n`));
			}

			// Agent
			const agents = projectConfig.configuredAgents.length > 0
				? projectConfig.configuredAgents
				: [projectConfig.agent];

			if (agents.length > 1) {
				agent = await select({
					message: "Agent:",
					choices: agents.map((a) => ({ name: a, value: a })),
					theme: promptTheme,
				});
			} else {
				agent = agents[0];
			}
		} else {
			command = await input({
				message: "Shell command:",
				validate: (v) => (v.trim().length > 0 ? true : "Required"),
				theme: promptTheme,
			});
		}

		// Base branch
		const branch = await input({
			message: "Base branch:",
			default: projectConfig.branch,
			theme: promptTheme,
		});

		// PR behavior
		const prBehavior = await select<"new" | "update">({
			message: "PR behavior:",
			choices: [
				{ name: "New PR each run", value: "new" },
				{ name: "Update standing PR", value: "update" },
			],
			theme: promptTheme,
		});

		let prBranch: string | null = null;
		if (prBehavior === "update") {
			prBranch = await input({
				message: "Standing branch name:",
				default: `auto/${name}`,
				theme: promptTheme,
			});
		}

		const entry: ScheduleEntry = {
			id: randomUUID().slice(0, 8),
			name,
			cron,
			type,
			prompt: promptPath,
			agent,
			command,
			branch,
			prBehavior,
			prBranch,
			enabled: true,
			lastRun: null,
			createdAt: new Date().toISOString(),
		};

		addScheduleEntry(projectPath, entry);

		console.log();
		console.log(`  ${chalk.green("✓")} Schedule ${chalk.bold(name)} created`);
		console.log(`    ${chalk.dim("Cron:")} ${cron}`);
		console.log(`    ${chalk.dim("Type:")} ${type}`);
		if (prBehavior === "update") {
			console.log(`    ${chalk.dim("Branch:")} ${prBranch}`);
		}
		console.log();
	} catch (err) {
		if (isExitPromptError(err)) {
			console.log(chalk.dim("\n  Cancelled.\n"));
			return;
		}
		throw err;
	}
}

export async function scheduleList(projectPath: string): Promise<void> {
	const config = loadSchedulesConfig(projectPath);

	if (config.schedules.length === 0) {
		console.log(chalk.dim("  No schedules configured."));
		console.log(chalk.dim(`  Run ${chalk.cyan("pergentic schedule add")} to create one.`));
		return;
	}

	const nameW = Math.max(6, ...config.schedules.map((s) => s.name.length)) + 2;
	const cronW = Math.max(6, ...config.schedules.map((s) => s.cron.length)) + 2;
	const typeW = 12;
	const statusW = 12;

	const header = [
		"Name".padEnd(nameW),
		"Cron".padEnd(cronW),
		"Type".padEnd(typeW),
		"Status".padEnd(statusW),
		"Last Run",
	].join("");

	console.log();
	console.log(`  ${chalk.bold(header)}`);
	console.log(`  ${"─".repeat(header.length + 10)}`);

	for (const s of config.schedules) {
		const status = s.enabled ? chalk.green("enabled") : chalk.yellow("paused");
		const lastRun = s.lastRun
			? new Date(s.lastRun).toLocaleString()
			: chalk.dim("never");

		console.log(
			`  ${s.name.padEnd(nameW)}${s.cron.padEnd(cronW)}${s.type.padEnd(typeW)}${(s.enabled ? "enabled" : "paused").padEnd(statusW)}${s.lastRun ? new Date(s.lastRun).toLocaleString() : "never"}`,
		);
	}
	console.log();
}

export async function scheduleRemove(nameOrId: string, projectPath: string): Promise<void> {
	const removed = removeScheduleEntry(projectPath, nameOrId);
	if (removed) {
		console.log(`  ${chalk.green("✓")} Schedule ${chalk.bold(nameOrId)} removed`);
	} else {
		console.error(`  ${chalk.red("✗")} Schedule "${nameOrId}" not found`);
		process.exitCode = 1;
	}
}

export async function schedulePause(nameOrId: string, projectPath: string): Promise<void> {
	const updated = setScheduleEnabled(projectPath, nameOrId, false);
	if (updated) {
		console.log(`  ${chalk.green("✓")} Schedule ${chalk.bold(nameOrId)} paused`);
	} else {
		console.error(`  ${chalk.red("✗")} Schedule "${nameOrId}" not found`);
		process.exitCode = 1;
	}
}

export async function scheduleResume(nameOrId: string, projectPath: string): Promise<void> {
	const updated = setScheduleEnabled(projectPath, nameOrId, true);
	if (updated) {
		console.log(`  ${chalk.green("✓")} Schedule ${chalk.bold(nameOrId)} resumed`);
	} else {
		console.error(`  ${chalk.red("✗")} Schedule "${nameOrId}" not found`);
		process.exitCode = 1;
	}
}
