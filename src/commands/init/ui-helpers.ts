import chalk from "chalk";
import type { ProjectConfig } from "../../config/schema";
import { allAgents, isValidAgentName } from "./constants";
import type { AgentNameType } from "./constants";

export interface ToolCategory {
	id: string;
	label: string;
	isConfigured: (config: ProjectConfig) => boolean;
	configuredDetail?: (config: ProjectConfig) => string;
	configure: (config: ProjectConfig) => Promise<void>;
}

export function clearScreen(): void {
	process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
}

export function printHeader(): void {
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

export function formatChoice(cat: ToolCategory, config: ProjectConfig): string {
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

export function agentDisplayName(agent: AgentNameType): string {
	return allAgents.find((a) => a.value === agent)?.name ?? agent;
}

export function maskKey(key: string): string {
	if (key.length <= 10) return "***";
	return `${key.slice(0, 6)}***${key.slice(-4)}`;
}

export function printSummary(config: ProjectConfig, categories: ToolCategory[]): void {
	console.log(`  ${chalk.green("✓")} Agents: ${chalk.white(config.configuredAgents.map(agentDisplayName).join(", "))}`);
	console.log(`  ${chalk.green("✓")} Default: ${chalk.white(agentDisplayName(config.agent))}`);

	if (config.agentTools) {
		for (const [agentName, tools] of Object.entries(config.agentTools)) {
			if (tools.length > 0 && isValidAgentName(agentName)) {
				console.log(
					`  ${chalk.green("✓")} ${agentDisplayName(agentName)} tools: ${chalk.white(tools.join(", "))}`
				);
			}
		}
	}

	if (config.agentLabels) {
		for (const [agentName, labels] of Object.entries(config.agentLabels)) {
			if (labels.length > 0 && isValidAgentName(agentName)) {
				console.log(
					`  ${chalk.green("✓")} ${agentDisplayName(agentName)} labels: ${chalk.white(labels.join(", "))}`
				);
			}
		}
	}

	if (config.modelLabels) {
		for (const [agentName, labelMap] of Object.entries(config.modelLabels)) {
			const entries = Object.entries(labelMap);
			if (entries.length > 0 && isValidAgentName(agentName)) {
				const display = entries.map(([l, m]) => `${l}→${m}`).join(", ");
				console.log(
					`  ${chalk.green("✓")} ${agentDisplayName(agentName)} model labels: ${chalk.white(display)}`
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

	const configuredIntegrations = categories.filter(
		(c) => c.isConfigured(config) && c.id !== "project-settings"
	);
	const unconfiguredIntegrations = categories.filter(
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
}
