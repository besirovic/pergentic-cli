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
import { validateProjectPath } from "../utils/project-validation";
import { error, warn, success } from "../utils/ui";

export async function add(projectPath: string): Promise<void> {
	const validated = validateProjectPath(projectPath);
	if (!validated.ok) {
		error(validated.error);
		return;
	}
	const absPath = validated.value;

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
		const { init } = await import("./init/index.js");
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
			warn(`Failed to clone repo: ${err instanceof Error ? err.message : err}`);
		}
	}

	success(`Registered project: ${absPath}`);
}
