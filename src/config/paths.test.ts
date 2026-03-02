import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	globalConfigDir,
	globalConfigPath,
	projectsRegistryPath,
	daemonPidPath,
	daemonLogPath,
	stateFilePath,
	statsFilePath,
	workspacesDir,
	worktreesDir,
	repoDir,
	projectConfigPath,
} from "./paths";
import { homedir } from "node:os";
import { join } from "node:path";

describe("paths", () => {
	const originalEnv = process.env.PERGENTIC_HOME;

	afterEach(() => {
		if (originalEnv) {
			process.env.PERGENTIC_HOME = originalEnv;
		} else {
			delete process.env.PERGENTIC_HOME;
		}
	});

	it("uses default ~/.pergentic when PERGETNIC not set", () => {
		delete process.env.PERGENTIC_HOME;
		expect(globalConfigDir()).toBe(join(homedir(), ".pergentic"));
	});

	it("respects PERGENTIC_HOME env var", () => {
		process.env.PERGENTIC_HOME = "/tmp/test-pergentic";
		expect(globalConfigDir()).toBe("/tmp/test-pergentic");
		expect(globalConfigPath()).toBe("/tmp/test-pergentic/config.yaml");
		expect(projectsRegistryPath()).toBe("/tmp/test-pergentic/projects.yaml");
		expect(daemonPidPath()).toBe("/tmp/test-pergentic/daemon.pid");
		expect(daemonLogPath()).toBe("/tmp/test-pergentic/daemon.log");
		expect(stateFilePath()).toBe("/tmp/test-pergentic/state.json");
		expect(statsFilePath()).toBe("/tmp/test-pergentic/stats.json");
	});

	it("computes workspace paths", () => {
		process.env.PERGENTIC_HOME = "/tmp/dc";
		expect(workspacesDir()).toBe("/tmp/dc/workspaces");
		expect(workspacesDir("my-project")).toBe("/tmp/dc/workspaces/my-project");
		expect(worktreesDir("my-project")).toBe(
			"/tmp/dc/workspaces/my-project/worktrees"
		);
		expect(repoDir("my-project")).toBe("/tmp/dc/workspaces/my-project/repo");
	});

	it("computes project config path", () => {
		expect(projectConfigPath("/home/user/project")).toBe(
			"/home/user/project/.pergentic/config.yaml"
		);
	});
});
