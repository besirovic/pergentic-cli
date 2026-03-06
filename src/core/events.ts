import { appendFileSync } from "node:fs";
import { eventsFilePath } from "../config/paths";
import { ensureGlobalConfigDir } from "../config/loader";

export type LifecycleEventType =
	| "taskStarted"
	| "taskCompleted"
	| "taskFailed"
	| "prCreated";

export interface LifecycleEvent {
	timestamp: string;
	type: LifecycleEventType;
	taskId: string;
	project: string;
	title: string;
	duration?: number;
	cost?: number;
	prUrl?: string;
	error?: string;
}

export function recordEvent(event: LifecycleEvent): void {
	ensureGlobalConfigDir();
	appendFileSync(eventsFilePath(), JSON.stringify(event) + "\n");
}
