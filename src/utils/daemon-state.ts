import { existsSync, readFileSync } from "node:fs";
import { stateFilePath } from "../config/paths";

export interface DaemonState {
	status: string;
	uptime: number;
	projects: Array<{
		name: string;
		agent: string;
		status: string;
		lastActivity?: string;
	}>;
	activeTasks: unknown[];
	queuedTasks?: number;
	todayStats: {
		tasks: number;
		prs: number;
		failed: number;
		estimatedCost: number;
	};
}

export function readState(): DaemonState | null {
	const path = stateFilePath();
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as DaemonState;
	} catch {
		return null;
	}
}
