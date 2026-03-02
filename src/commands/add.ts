import { resolve, basename } from "node:path";
import { existsSync } from "node:fs";
import {
	loadProjectsRegistry,
	saveProjectsRegistry,
	loadProjectConfig,
	ensureGlobalConfigDir,
} from "../config/loader";
import { projectConfigPath } from "../config/paths";
import { ensureRepoClone } from "../core/worktree";

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

	// Ensure repo is cloned for worktree use
	const config = loadProjectConfig(absPath);
	if (config.repo) {
		const projectName = basename(absPath);
		try {
			await ensureRepoClone(projectName, config.repo, config.branch);
		} catch (err) {
			console.log(
				`⚠️  Failed to clone repo: ${err instanceof Error ? err.message : err}`,
			);
		}
	}

	console.log(`✅ Registered project: ${absPath}`);
}
