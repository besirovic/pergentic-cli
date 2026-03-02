import { resolve, basename } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { loadProjectsRegistry } from "../config/loader";
import { stateFilePath } from "../config/paths";

interface DaemonState {
	status: string;
	projects?: Array<{
		name: string;
		agent: string;
		status: string;
		lastActivity?: string;
	}>;
}

function readState(): DaemonState | null {
	const path = stateFilePath();
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as DaemonState;
	} catch {
		return null;
	}
}

export async function list(): Promise<void> {
	const registry = loadProjectsRegistry();

	if (registry.projects.length === 0) {
		console.log("\nNo projects registered.");
		console.log("Run `pergentic add <path>` to register a project.\n");
		return;
	}

	const state = readState();
	const stateProjects = new Map(
		(state?.projects ?? []).map((p) => [p.name, p])
	);

	console.log("");

	// Header
	const header = [
		"Project".padEnd(20),
		"Path".padEnd(40),
		"Status".padEnd(12),
	].join("  ");
	console.log(header);
	console.log("-".repeat(header.length));

	for (const entry of registry.projects) {
		const absPath = resolve(entry.path);
		const name = basename(absPath);
		const stateEntry = stateProjects.get(name);
		const status = stateEntry?.status ?? "unknown";

		const row = [name.padEnd(20), absPath.padEnd(40), status.padEnd(12)].join(
			"  "
		);
		console.log(row);
	}

	console.log("");
}
