import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
	SchedulesConfigSchema,
	type ScheduleEntry,
	type SchedulesConfig,
} from "./schema";
import { schedulesConfigPath, schedulesDir, schedulePromptPath } from "./paths";

function readYaml(filePath: string): unknown {
	if (!existsSync(filePath)) return {};
	const raw = readFileSync(filePath, "utf-8");
	return parseYaml(raw) ?? {};
}

function writeYaml(filePath: string, data: unknown): void {
	const dir = dirname(filePath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, stringifyYaml(data), "utf-8");
}

export function loadSchedulesConfig(projectPath: string): SchedulesConfig {
	const raw = readYaml(schedulesConfigPath(projectPath));
	return SchedulesConfigSchema.parse(raw);
}

export function saveSchedulesConfig(projectPath: string, config: SchedulesConfig): void {
	writeYaml(schedulesConfigPath(projectPath), config);
}

export function addScheduleEntry(projectPath: string, entry: ScheduleEntry): void {
	const config = loadSchedulesConfig(projectPath);
	config.schedules.push(entry);
	saveSchedulesConfig(projectPath, config);
}

export function removeScheduleEntry(projectPath: string, nameOrId: string): boolean {
	const config = loadSchedulesConfig(projectPath);
	const before = config.schedules.length;
	config.schedules = config.schedules.filter(
		(s) => s.name !== nameOrId && s.id !== nameOrId,
	);
	if (config.schedules.length === before) return false;
	saveSchedulesConfig(projectPath, config);
	return true;
}

export function setScheduleEnabled(projectPath: string, nameOrId: string, enabled: boolean): boolean {
	const config = loadSchedulesConfig(projectPath);
	const entry = config.schedules.find((s) => s.name === nameOrId || s.id === nameOrId);
	if (!entry) return false;
	entry.enabled = enabled;
	saveSchedulesConfig(projectPath, config);
	return true;
}

export function updateLastRun(projectPath: string, scheduleId: string, timestamp: string): void {
	const config = loadSchedulesConfig(projectPath);
	const entry = config.schedules.find((s) => s.id === scheduleId);
	if (entry) {
		entry.lastRun = timestamp;
		saveSchedulesConfig(projectPath, config);
	}
}

export function ensureSchedulesDir(projectPath: string): void {
	const dir = schedulesDir(projectPath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function writePromptFile(projectPath: string, relativePath: string, content: string): void {
	const fullPath = schedulePromptPath(projectPath, relativePath);
	const dir = dirname(fullPath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(fullPath, content, "utf-8");
}

export function readPromptFile(projectPath: string, relativePath: string): string | null {
	const fullPath = schedulePromptPath(projectPath, relativePath);
	if (!existsSync(fullPath)) return null;
	return readFileSync(fullPath, "utf-8");
}

export function PROMPT_TEMPLATE(name: string): string {
	return `# ${name}

<!-- Describe the task for the coding agent. -->
<!-- Edit anytime — changes take effect on the next scheduled run. -->

## Task


## Constraints

`;
}
