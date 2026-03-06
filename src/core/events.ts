import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { eventsFilePath } from "../config/paths";
import { ensureGlobalConfigDir } from "../config/loader";
import { safeAppendFile } from "../utils/fs";

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
	safeAppendFile(eventsFilePath(), JSON.stringify(event) + "\n");
}

export function pruneEvents(maxEntries: number = 10000): void {
	const filePath = eventsFilePath();
	if (!existsSync(filePath)) return;

	const content = readFileSync(filePath, "utf-8");
	const lines = content.split("\n").filter((l) => l.trim());

	if (lines.length <= maxEntries) return;

	const retained = lines.slice(-maxEntries);
	writeFileSync(filePath, retained.join("\n") + "\n");
}
