import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import {
	loadGlobalConfig,
	saveGlobalConfig,
	loadProjectsRegistry,
	saveProjectsRegistry,
	loadProjectConfig,
	saveProjectConfig,
	ensureGlobalConfigDir,
	readRawGlobalConfig,
} from "./loader";

const TEST_HOME = join("/tmp", `pergentic-test-${process.pid}`);

describe("config loader", () => {
	beforeEach(() => {
		process.env.PERGENTIC_HOME = TEST_HOME;
		if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
		mkdirSync(TEST_HOME, { recursive: true });
	});

	afterEach(() => {
		delete process.env.PERGENTIC_HOME;
		if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
	});

	it("returns defaults for missing global config", () => {
		const config = loadGlobalConfig();
		expect(config.pollInterval).toBe(30);
		expect(config.maxConcurrent).toBe(2);
	});

	it("saves and loads global config", () => {
		const config = {
			pollInterval: 45,
			maxConcurrent: 3,
			statusPort: 7890,
		};
		saveGlobalConfig(config);
		const loaded = loadGlobalConfig();
		expect(loaded.pollInterval).toBe(45);
		expect(loaded.maxConcurrent).toBe(3);
	});

	it("saves and loads projects registry", () => {
		const registry = {
			projects: [{ path: "/tmp/project-a" }, { path: "/tmp/project-b" }],
		};
		saveProjectsRegistry(registry);
		const loaded = loadProjectsRegistry();
		expect(loaded.projects).toHaveLength(2);
		expect(loaded.projects[0].path).toBe("/tmp/project-a");
	});

	it("returns empty registry when file missing", () => {
		const registry = loadProjectsRegistry();
		expect(registry.projects).toEqual([]);
	});

	it("saves and loads project config", () => {
		const projectPath = join(TEST_HOME, "my-project");
		mkdirSync(projectPath, { recursive: true });

		const config = {
			repo: "git@github.com:user/repo.git",
			branch: "main",
			agent: "claude-code" as const,
			configuredAgents: [] as ("claude-code" | "codex" | "aider" | "opencode")[],
		};
		saveProjectConfig(projectPath, config);
		const loaded = loadProjectConfig(projectPath);
		expect(loaded.repo).toBe("git@github.com:user/repo.git");
		expect(loaded.agent).toBe("claude-code");
	});

	it("ensures global config dir exists", () => {
		const newHome = join(TEST_HOME, "nested", "deep");
		process.env.PERGENTIC_HOME = newHome;
		ensureGlobalConfigDir();
		expect(existsSync(newHome)).toBe(true);
	});

	it("readRawGlobalConfig returns raw data without schema validation", () => {
		const rawData = {
			anthropicApiKey: "sk-ant-legacy",
			githubToken: "ghp_legacy",
			pollInterval: 30,
			unknownField: "should-be-preserved",
		};
		const configPath = join(TEST_HOME, "config.yaml");
		writeFileSync(configPath, stringifyYaml(rawData), "utf-8");

		const raw = readRawGlobalConfig();
		expect(raw.anthropicApiKey).toBe("sk-ant-legacy");
		expect(raw.githubToken).toBe("ghp_legacy");
		expect(raw.unknownField).toBe("should-be-preserved");
	});

	it("readRawGlobalConfig returns empty object when file missing", () => {
		const raw = readRawGlobalConfig();
		expect(raw).toEqual({});
	});
});
