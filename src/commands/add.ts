import { resolve } from "node:path";
import { existsSync } from "node:fs";
import {
	loadProjectsRegistry,
	saveProjectsRegistry,
	ensureGlobalConfigDir,
} from "../config/loader";
import { projectConfigPath } from "../config/paths";

export async function add(projectPath: string): Promise<void> {
	const absPath = resolve(projectPath);

	if (!existsSync(absPath)) {
		console.error(`Error: Directory does not exist: ${absPath}`);
		process.exitCode = 1;
		return;
	}

	// Check if it's a git repo
	if (!existsSync(resolve(absPath, ".git"))) {
		console.error(`Error: Not a git repository: ${absPath}`);
		process.exitCode = 1;
		return;
	}

	ensureGlobalConfigDir();
	const registry = loadProjectsRegistry();

	// Check for duplicates
	if (registry.projects.some((p) => resolve(p.path) === absPath)) {
		console.log(`Project already registered: ${absPath}`);
		return;
	}

	// If no project config exists, delegate to init wizard
	const configFile = projectConfigPath(absPath);
	if (!existsSync(configFile)) {
		const { init } = await import("./init.js");
		await init(absPath);
		return;
	}

	// Config exists, just register the project
	registry.projects.push({ path: absPath });
	saveProjectsRegistry(registry);
	console.log(`✅ Registered project: ${absPath}`);
}
