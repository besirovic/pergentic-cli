import { homedir } from "node:os";
import { join } from "node:path";

function pergenticHome(): string {
	return process.env.PERGENTIC_HOME ?? join(homedir(), ".pergentic");
}

export function globalConfigDir(): string {
	return pergenticHome();
}

export function globalConfigPath(): string {
	return join(pergenticHome(), "config.yaml");
}

export function projectsRegistryPath(): string {
	return join(pergenticHome(), "projects.yaml");
}

export function daemonPidPath(): string {
	return join(pergenticHome(), "daemon.pid");
}

export function daemonLockPath(): string {
	return join(pergenticHome(), "daemon.lock");
}

export function daemonLogPath(): string {
	return join(pergenticHome(), "daemon.log");
}

export function stateFilePath(): string {
	return join(pergenticHome(), "state.json");
}

export function statsFilePath(): string {
	return join(pergenticHome(), "stats.json");
}

export function workspacesDir(projectName?: string): string {
	const base = join(pergenticHome(), "workspaces");
	return projectName ? join(base, projectName) : base;
}

export function worktreesDir(projectName: string): string {
	return join(workspacesDir(projectName), "worktrees");
}

export function repoDir(projectName: string): string {
	return join(workspacesDir(projectName), "repo");
}

export function projectConfigPath(projectPath: string): string {
	return join(projectPath, ".pergentic", "config.yaml");
}

export function projectEnvPath(projectPath: string): string {
	return join(projectPath, ".pergentic", ".env");
}

export function eventsFilePath(): string {
	return join(pergenticHome(), "events.jsonl");
}

export function envFilePath(): string {
	return join(pergenticHome(), ".env");
}

export function dispatchedLedgerPath(): string {
	return join(pergenticHome(), "dispatched.jsonl");
}

export function schedulesConfigPath(projectPath: string): string {
	return join(projectPath, ".pergentic", "schedules.yaml");
}

export function schedulesDir(projectPath: string): string {
	return join(projectPath, ".pergentic", "schedules");
}

export function schedulePromptPath(projectPath: string, relativePath: string): string {
	return join(projectPath, ".pergentic", relativePath);
}
