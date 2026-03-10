import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { eventsFilePath } from "../config/paths";
import { ensureGlobalConfigDir } from "../config/loader";
import { safeAppendFileAsync } from "../utils/fs";

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
	retriesAttempted?: number;
}

export async function recordEvent(event: LifecycleEvent): Promise<void> {
	ensureGlobalConfigDir();
	await safeAppendFileAsync(eventsFilePath(), JSON.stringify(event) + "\n");
}

export const MAX_EVENT_ENTRIES = 10_000;

export async function pruneEvents(maxEntries: number = MAX_EVENT_ENTRIES): Promise<void> {
	const filePath = eventsFilePath();
	if (!existsSync(filePath)) return;

	const content = await readFile(filePath, "utf-8");
	const lines = content.split("\n").filter((l) => l.trim());

	if (lines.length <= maxEntries) return;

	const retained = lines.slice(-maxEntries);
	await writeFile(filePath, retained.join("\n") + "\n");
}
