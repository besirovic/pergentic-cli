import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync, writeSync, openSync, closeSync } from "node:fs";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import {
	loadGlobalConfig,
	saveGlobalConfig,
	loadProjectsRegistry,
	saveProjectsRegistry,
	loadProjectConfig,
	saveProjectConfig,
	modifyProjectsRegistry,
	modifyProjectConfig,
	ensureGlobalConfigDir,
	readRawGlobalConfig,
} from "./loader";
import { readYaml, withFileLock } from "./yaml-io";

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

	it("merges env secrets into project config", () => {
		const projectPath = join(TEST_HOME, "env-project");
		mkdirSync(join(projectPath, ".pergentic"), { recursive: true });

		// Save config without secrets
		const config = {
			repo: "git@github.com:user/repo.git",
			branch: "main",
			agent: "claude-code" as const,
			configuredAgents: [] as ("claude-code" | "codex" | "aider" | "opencode")[],
		};
		saveProjectConfig(projectPath, config);

		// Write secrets to project .env
		writeFileSync(
			join(projectPath, ".pergentic", ".env"),
			"PERGENTIC_ANTHROPIC_API_KEY=sk-ant-from-env\nPERGENTIC_GITHUB_TOKEN=ghp_from_env\n",
		);

		const loaded = loadProjectConfig(projectPath);
		expect(loaded.anthropicApiKey).toBe("sk-ant-from-env");
		expect(loaded.githubToken).toBe("ghp_from_env");
	});

	it("config file secrets take precedence over env secrets", () => {
		const projectPath = join(TEST_HOME, "precedence-project");
		mkdirSync(join(projectPath, ".pergentic"), { recursive: true });

		// Save config with a secret
		const config = {
			repo: "git@github.com:user/repo.git",
			branch: "main",
			agent: "claude-code" as const,
			configuredAgents: [] as ("claude-code" | "codex" | "aider" | "opencode")[],
			anthropicApiKey: "sk-ant-from-config",
		};
		saveProjectConfig(projectPath, config);

		// Write different secret to .env
		writeFileSync(
			join(projectPath, ".pergentic", ".env"),
			"PERGENTIC_ANTHROPIC_API_KEY=sk-ant-from-env\n",
		);

		const loaded = loadProjectConfig(projectPath);
		expect(loaded.anthropicApiKey).toBe("sk-ant-from-config");
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

	it("readYaml throws error with file path for malformed YAML", () => {
		const malformedPath = join(TEST_HOME, "malformed.yaml");
		writeFileSync(malformedPath, "key: [\ninvalid: yaml\n", "utf-8");

		expect(() => readYaml(malformedPath)).toThrow(
			/Failed to parse YAML config at .*malformed\.yaml/,
		);
	});

	it("readYaml returns {} for empty files", () => {
		const emptyPath = join(TEST_HOME, "empty.yaml");
		writeFileSync(emptyPath, "", "utf-8");

		expect(readYaml(emptyPath)).toEqual({});
	});
});

describe("withFileLock", () => {
	const TEST_LOCK_HOME = join("/tmp", `pergentic-lock-test-${process.pid}`);

	beforeEach(() => {
		if (existsSync(TEST_LOCK_HOME)) rmSync(TEST_LOCK_HOME, { recursive: true });
		mkdirSync(TEST_LOCK_HOME, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(TEST_LOCK_HOME)) rmSync(TEST_LOCK_HOME, { recursive: true });
	});

	it("runs the callback and returns its value", () => {
		const filePath = join(TEST_LOCK_HOME, "data.yaml");
		writeFileSync(filePath, "", "utf-8");

		const result = withFileLock(filePath, () => 42);
		expect(result).toBe(42);
	});

	it("cleans up the lock file after success", () => {
		const filePath = join(TEST_LOCK_HOME, "data.yaml");
		writeFileSync(filePath, "", "utf-8");
		const lockPath = filePath + ".lock";

		withFileLock(filePath, () => {});
		expect(existsSync(lockPath)).toBe(false);
	});

	it("cleans up the lock file after an error in callback", () => {
		const filePath = join(TEST_LOCK_HOME, "data.yaml");
		writeFileSync(filePath, "", "utf-8");
		const lockPath = filePath + ".lock";

		expect(() =>
			withFileLock(filePath, () => {
				throw new Error("boom");
			}),
		).toThrow("boom");
		expect(existsSync(lockPath)).toBe(false);
	});

	it("throws when a stale lock file blocks acquisition", { timeout: 10000 }, () => {
		const filePath = join(TEST_LOCK_HOME, "data.yaml");
		writeFileSync(filePath, "", "utf-8");
		const lockPath = filePath + ".lock";

		// Simulate a stuck lock by writing it manually and never releasing
		const fd = openSync(lockPath, "wx");
		closeSync(fd);

		expect(() =>
			withFileLock(filePath, () => {}),
		).toThrow(/Failed to acquire lock/);

		// Clean up the stale lock
		rmSync(lockPath);
	});
});

describe("modifyProjectsRegistry", () => {
	const TEST_HOME2 = join("/tmp", `pergentic-modify-test-${process.pid}`);

	beforeEach(() => {
		process.env.PERGENTIC_HOME = TEST_HOME2;
		if (existsSync(TEST_HOME2)) rmSync(TEST_HOME2, { recursive: true });
		mkdirSync(TEST_HOME2, { recursive: true });
	});

	afterEach(() => {
		delete process.env.PERGENTIC_HOME;
		if (existsSync(TEST_HOME2)) rmSync(TEST_HOME2, { recursive: true });
	});

	it("adds a project atomically", () => {
		modifyProjectsRegistry((r) => {
			r.projects.push({ path: "/tmp/proj-a" });
		});
		const loaded = loadProjectsRegistry();
		expect(loaded.projects).toHaveLength(1);
		expect(loaded.projects[0].path).toBe("/tmp/proj-a");
	});

	it("removes a project atomically", () => {
		saveProjectsRegistry({ projects: [{ path: "/tmp/proj-a" }, { path: "/tmp/proj-b" }] });

		modifyProjectsRegistry((r) => {
			r.projects = r.projects.filter((p) => p.path !== "/tmp/proj-a");
		});

		const loaded = loadProjectsRegistry();
		expect(loaded.projects).toHaveLength(1);
		expect(loaded.projects[0].path).toBe("/tmp/proj-b");
	});

	it("preserves all existing entries when adding", () => {
		saveProjectsRegistry({ projects: [{ path: "/tmp/proj-existing" }] });

		modifyProjectsRegistry((r) => {
			r.projects.push({ path: "/tmp/proj-new" });
		});

		const loaded = loadProjectsRegistry();
		expect(loaded.projects).toHaveLength(2);
	});
});

describe("modifyProjectConfig", () => {
	const TEST_HOME3 = join("/tmp", `pergentic-modcfg-test-${process.pid}`);

	beforeEach(() => {
		process.env.PERGENTIC_HOME = TEST_HOME3;
		if (existsSync(TEST_HOME3)) rmSync(TEST_HOME3, { recursive: true });
		mkdirSync(TEST_HOME3, { recursive: true });
	});

	afterEach(() => {
		delete process.env.PERGENTIC_HOME;
		if (existsSync(TEST_HOME3)) rmSync(TEST_HOME3, { recursive: true });
	});

	it("updates a project config field atomically", () => {
		const projectPath = join(TEST_HOME3, "proj");
		mkdirSync(join(projectPath, ".pergentic"), { recursive: true });

		saveProjectConfig(projectPath, {
			repo: "git@github.com:user/repo.git",
			branch: "main",
			agent: "claude-code" as const,
			configuredAgents: [],
		});

		modifyProjectConfig(projectPath, (c) => {
			c.branch = "develop";
		});

		const loaded = loadProjectConfig(projectPath);
		expect(loaded.branch).toBe("develop");
		expect(loaded.repo).toBe("git@github.com:user/repo.git");
	});
});
