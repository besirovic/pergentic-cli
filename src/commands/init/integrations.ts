import { select, input, checkbox, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { loadGlobalConfig } from "../../config/loader";
import { promptTheme } from "../../utils/prompt-helpers";
import { logger } from "../../utils/logger";
import type { ProjectConfig } from "../../config/schema";
import type { ToolCategory } from "./ui-helpers";

export async function configureGitHub(config: ProjectConfig): Promise<void> {
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

export async function configureLinear(config: ProjectConfig): Promise<void> {
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

export async function configureJira(config: ProjectConfig): Promise<void> {
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

export async function configureSlack(config: ProjectConfig): Promise<void> {
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

export async function configureNotifications(config: ProjectConfig): Promise<void> {
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

export async function configureProjectSettings(config: ProjectConfig): Promise<void> {
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

export const menuCategories: ToolCategory[] = [
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
			} catch (err) {
				logger.debug({ err }, "Global config not loaded, treating as unconfigured");
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
