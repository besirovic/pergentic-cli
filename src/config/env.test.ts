import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import {
  parseEnvFile,
  loadSecrets,
  saveProjectEnv,
  migrateConfigSecrets,
  extractSecrets,
  SECRET_FIELDS,
} from "./env";

const TEST_HOME = join("/tmp", `pergentic-env-test-${process.pid}`);
const TEST_PROJECT = join("/tmp", `pergentic-env-project-${process.pid}`);

describe("parseEnvFile", () => {
  const envFile = join(TEST_HOME, "test.env");

  beforeEach(() => {
    mkdirSync(TEST_HOME, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
  });

  it("returns empty object for missing file", () => {
    expect(parseEnvFile("/nonexistent/.env")).toEqual({});
  });

  it("parses simple key=value pairs", () => {
    writeFileSync(envFile, "FOO=bar\nBAZ=qux\n");
    expect(parseEnvFile(envFile)).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("ignores comments and blank lines", () => {
    writeFileSync(envFile, "# comment\n\nFOO=bar\n  # another comment\n");
    expect(parseEnvFile(envFile)).toEqual({ FOO: "bar" });
  });

  it("strips double quotes from values", () => {
    writeFileSync(envFile, 'KEY="hello world"\n');
    expect(parseEnvFile(envFile)).toEqual({ KEY: "hello world" });
  });

  it("strips single quotes from values", () => {
    writeFileSync(envFile, "KEY='hello world'\n");
    expect(parseEnvFile(envFile)).toEqual({ KEY: "hello world" });
  });

  it("handles values with equals signs", () => {
    writeFileSync(envFile, "KEY=foo=bar=baz\n");
    expect(parseEnvFile(envFile)).toEqual({ KEY: "foo=bar=baz" });
  });

  it("handles empty values", () => {
    writeFileSync(envFile, "KEY=\n");
    expect(parseEnvFile(envFile)).toEqual({ KEY: "" });
  });

  it("trims whitespace around keys and values", () => {
    writeFileSync(envFile, "  KEY  =  value  \n");
    expect(parseEnvFile(envFile)).toEqual({ KEY: "value" });
  });
});

describe("loadSecrets", () => {
  beforeEach(() => {
    process.env.PERGENTIC_HOME = TEST_HOME;
    mkdirSync(TEST_HOME, { recursive: true });
    mkdirSync(join(TEST_PROJECT, ".pergentic"), { recursive: true });
  });

  afterEach(() => {
    delete process.env.PERGENTIC_HOME;
    // Clean up any PERGENTIC_ env vars
    for (const envVar of Object.values(SECRET_FIELDS)) {
      delete process.env[envVar];
    }
    if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
    if (existsSync(TEST_PROJECT)) rmSync(TEST_PROJECT, { recursive: true });
  });

  it("returns empty secrets when no env files exist", () => {
    const secrets = loadSecrets(TEST_PROJECT);
    expect(secrets).toEqual({});
  });

  it("loads secrets from global .env", () => {
    writeFileSync(
      join(TEST_HOME, ".env"),
      "PERGENTIC_ANTHROPIC_API_KEY=sk-ant-global\n",
    );
    const secrets = loadSecrets(TEST_PROJECT);
    expect(secrets.anthropicApiKey).toBe("sk-ant-global");
  });

  it("project .env overrides global .env", () => {
    writeFileSync(
      join(TEST_HOME, ".env"),
      "PERGENTIC_ANTHROPIC_API_KEY=sk-ant-global\n",
    );
    writeFileSync(
      join(TEST_PROJECT, ".pergentic", ".env"),
      "PERGENTIC_ANTHROPIC_API_KEY=sk-ant-project\n",
    );
    const secrets = loadSecrets(TEST_PROJECT);
    expect(secrets.anthropicApiKey).toBe("sk-ant-project");
  });

  it("process.env overrides .env files", () => {
    writeFileSync(
      join(TEST_PROJECT, ".pergentic", ".env"),
      "PERGENTIC_GITHUB_TOKEN=ghp_file\n",
    );
    process.env.PERGENTIC_GITHUB_TOKEN = "ghp_env";
    const secrets = loadSecrets(TEST_PROJECT);
    expect(secrets.githubToken).toBe("ghp_env");
  });

  it("loads multiple secret fields", () => {
    writeFileSync(
      join(TEST_PROJECT, ".pergentic", ".env"),
      [
        "PERGENTIC_ANTHROPIC_API_KEY=sk-ant-123",
        "PERGENTIC_GITHUB_TOKEN=ghp_456",
        "PERGENTIC_LINEAR_API_KEY=lin_api_789",
      ].join("\n") + "\n",
    );
    const secrets = loadSecrets(TEST_PROJECT);
    expect(secrets.anthropicApiKey).toBe("sk-ant-123");
    expect(secrets.githubToken).toBe("ghp_456");
    expect(secrets.linearApiKey).toBe("lin_api_789");
  });
});

describe("saveProjectEnv", () => {
  beforeEach(() => {
    mkdirSync(join(TEST_PROJECT, ".pergentic"), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_PROJECT)) rmSync(TEST_PROJECT, { recursive: true });
  });

  it("writes secrets to .pergentic/.env", () => {
    saveProjectEnv(TEST_PROJECT, {
      anthropicApiKey: "sk-ant-test",
      githubToken: "ghp_test",
    });

    const content = readFileSync(
      join(TEST_PROJECT, ".pergentic", ".env"),
      "utf-8",
    );
    expect(content).toContain("PERGENTIC_ANTHROPIC_API_KEY=sk-ant-test");
    expect(content).toContain("PERGENTIC_GITHUB_TOKEN=ghp_test");
  });

  it("preserves existing non-secret entries", () => {
    writeFileSync(
      join(TEST_PROJECT, ".pergentic", ".env"),
      "CUSTOM_VAR=keep-me\n",
    );
    saveProjectEnv(TEST_PROJECT, { anthropicApiKey: "sk-ant-new" });

    const content = readFileSync(
      join(TEST_PROJECT, ".pergentic", ".env"),
      "utf-8",
    );
    expect(content).toContain("CUSTOM_VAR=keep-me");
    expect(content).toContain("PERGENTIC_ANTHROPIC_API_KEY=sk-ant-new");
  });
});

describe("migrateConfigSecrets", () => {
  beforeEach(() => {
    mkdirSync(join(TEST_PROJECT, ".pergentic"), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_PROJECT)) rmSync(TEST_PROJECT, { recursive: true });
  });

  it("returns not migrated when no config file exists", () => {
    const result = migrateConfigSecrets("/nonexistent/path");
    expect(result).toEqual({ migrated: false, fields: [] });
  });

  it("migrates secrets from config.yaml to .env", () => {
    const config = {
      repo: "git@github.com:user/repo.git",
      branch: "main",
      agent: "claude-code",
      anthropicApiKey: "sk-ant-migrate",
      githubToken: "ghp_migrate",
    };
    writeFileSync(
      join(TEST_PROJECT, ".pergentic", "config.yaml"),
      stringifyYaml(config),
    );

    const result = migrateConfigSecrets(TEST_PROJECT);
    expect(result.migrated).toBe(true);
    expect(result.fields).toContain("anthropicApiKey");
    expect(result.fields).toContain("githubToken");

    // Secrets should be in .env
    const envContent = readFileSync(
      join(TEST_PROJECT, ".pergentic", ".env"),
      "utf-8",
    );
    expect(envContent).toContain("PERGENTIC_ANTHROPIC_API_KEY=sk-ant-migrate");
    expect(envContent).toContain("PERGENTIC_GITHUB_TOKEN=ghp_migrate");

    // Secrets should be removed from config.yaml
    const configContent = readFileSync(
      join(TEST_PROJECT, ".pergentic", "config.yaml"),
      "utf-8",
    );
    expect(configContent).not.toContain("anthropicApiKey");
    expect(configContent).not.toContain("githubToken");
    // Non-secret fields should remain
    expect(configContent).toContain("repo");
    expect(configContent).toContain("branch");
  });

  it("returns not migrated when no secrets in config", () => {
    const config = {
      repo: "git@github.com:user/repo.git",
      branch: "main",
      agent: "claude-code",
    };
    writeFileSync(
      join(TEST_PROJECT, ".pergentic", "config.yaml"),
      stringifyYaml(config),
    );

    const result = migrateConfigSecrets(TEST_PROJECT);
    expect(result).toEqual({ migrated: false, fields: [] });
  });
});

describe("extractSecrets", () => {
  it("extracts secret fields from config object", () => {
    const config = {
      repo: "git@github.com:user/repo.git",
      branch: "main",
      anthropicApiKey: "sk-ant-extract",
      githubToken: "ghp_extract",
    };

    const { secrets, cleaned } = extractSecrets(config);

    expect(secrets.anthropicApiKey).toBe("sk-ant-extract");
    expect(secrets.githubToken).toBe("ghp_extract");
    expect(cleaned).not.toHaveProperty("anthropicApiKey");
    expect(cleaned).not.toHaveProperty("githubToken");
    expect(cleaned.repo).toBe("git@github.com:user/repo.git");
    expect(cleaned.branch).toBe("main");
  });

  it("returns empty secrets when none present", () => {
    const config = { repo: "git@github.com:user/repo.git", branch: "main" };
    const { secrets, cleaned } = extractSecrets(config);
    expect(secrets).toEqual({});
    expect(cleaned).toEqual(config);
  });
});
