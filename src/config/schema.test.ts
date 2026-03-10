import { describe, it, expect } from "vitest";
import {
  GlobalConfigSchema,
  ProjectConfigSchema,
  ProjectsRegistrySchema,
} from "./schema";

describe("GlobalConfigSchema", () => {
  it("parses minimal config with defaults", () => {
    const result = GlobalConfigSchema.parse({});
    expect(result.pollInterval).toBe(30);
    expect(result.maxConcurrent).toBe(2);
    expect(result.statusPort).toBe(7890);
  });

  it("parses full config", () => {
    const result = GlobalConfigSchema.parse({
      pollInterval: 60,
      maxConcurrent: 4,
      notifications: {
        slack: {
          webhook: "https://hooks.slack.com/test",
          on: { taskCompleted: true, taskFailed: true, prCreated: false },
        },
      },
    });
    expect(result.pollInterval).toBe(60);
    expect(result.notifications?.slack?.on.taskCompleted).toBe(true);
  });

  it("silently strips unknown keys (legacy API keys)", () => {
    const result = GlobalConfigSchema.parse({
      anthropicApiKey: "sk-ant-test",
      githubToken: "ghp_test",
      pollInterval: 30,
    });
    expect(result.pollInterval).toBe(30);
    expect((result as Record<string, unknown>).anthropicApiKey).toBeUndefined();
  });

  it("rejects invalid poll interval", () => {
    expect(() =>
      GlobalConfigSchema.parse({ pollInterval: 2 }),
    ).toThrow();
  });
});

describe("ProjectConfigSchema", () => {
  it("parses minimal project config", () => {
    const result = ProjectConfigSchema.parse({
      repo: "git@github.com:user/repo.git",
    });
    expect(result.branch).toBe("main");
    expect(result.agent).toBe("claude-code");
    expect(result.configuredAgents).toEqual([]);
  });

  it("parses full project config with credentials", () => {
    const result = ProjectConfigSchema.parse({
      repo: "git@github.com:user/repo.git",
      branch: "develop",
      agent: "aider",
      configuredAgents: ["claude-code", "aider"],
      anthropicApiKey: "sk-ant-test123",
      openaiApiKey: "sk-openai-test",
      openrouterApiKey: "sk-or-test",
      agentProviders: {
        "claude-code": "anthropic",
        aider: "openrouter",
      },
      githubToken: "ghp_testtoken",
      linearApiKey: "lin_api_testkey",
      slackBotToken: "xoxb-test",
      slackAppToken: "xapp-test",
      jiraDomain: "mycompany.atlassian.net",
      jiraEmail: "user@example.com",
      jiraApiToken: "jira-token",
      linearTeamId: "PROJ",
      claude: {
        instructions: "CLAUDE.md",
        maxCostPerTask: 5.0,
        allowedTools: ["edit", "bash"],
      },
      pr: {
        titleFormat: "fix: {taskTitle}",
        labels: ["bot"],
      },
      feedback: {
        maxRounds: 3,
      },
    });
    expect(result.agent).toBe("aider");
    expect(result.configuredAgents).toEqual(["claude-code", "aider"]);
    expect(result.anthropicApiKey).toBe("sk-ant-test123");
    expect(result.openaiApiKey).toBe("sk-openai-test");
    expect(result.openrouterApiKey).toBe("sk-or-test");
    expect(result.agentProviders).toEqual({
      "claude-code": "anthropic",
      aider: "openrouter",
    });
    expect(result.githubToken).toBe("ghp_testtoken");
    expect(result.linearApiKey).toBe("lin_api_testkey");
    expect(result.jiraEmail).toBe("user@example.com");
    expect(result.claude?.maxCostPerTask).toBe(5.0);
    expect(result.feedback?.maxRounds).toBe(3);
  });

  it("parses config without new optional fields", () => {
    const result = ProjectConfigSchema.parse({
      repo: "git@github.com:user/repo.git",
    });
    expect(result.openaiApiKey).toBeUndefined();
    expect(result.openrouterApiKey).toBeUndefined();
    expect(result.agentProviders).toBeUndefined();
  });

  it("applies agentTimeout default when claude object is present but field is omitted", () => {
    const result = ProjectConfigSchema.parse({
      repo: "test",
      claude: {},
    });
    expect(result.claude?.agentTimeout).toBe(3600);
  });

  it("applies commandTimeout default when verification object is present but field is omitted", () => {
    const result = ProjectConfigSchema.parse({
      repo: "test",
      verification: {},
    });
    expect(result.verification?.commandTimeout).toBe(300);
  });

  it("rejects invalid agent provider", () => {
    expect(() =>
      ProjectConfigSchema.parse({
        repo: "test",
        agentProviders: { "claude-code": "invalid-provider" },
      }),
    ).toThrow();
  });

  it("rejects invalid agent", () => {
    expect(() =>
      ProjectConfigSchema.parse({
        repo: "test",
        agent: "invalid-agent",
      }),
    ).toThrow();
  });

  it("parses modelLabels correctly", () => {
    const result = ProjectConfigSchema.parse({
      repo: "git@github.com:user/repo.git",
      configuredAgents: ["claude-code", "codex"],
      modelLabels: {
        "claude-code": {
          "claude-opus": "claude-opus-4-20250514",
          "claude-sonnet": "claude-sonnet-4-20250514",
        },
        codex: {
          "gpt-4.1": "gpt-4.1",
        },
      },
    });
    expect(result.modelLabels).toEqual({
      "claude-code": {
        "claude-opus": "claude-opus-4-20250514",
        "claude-sonnet": "claude-sonnet-4-20250514",
      },
      codex: {
        "gpt-4.1": "gpt-4.1",
      },
    });
  });

  it("modelLabels defaults to undefined when not provided", () => {
    const result = ProjectConfigSchema.parse({
      repo: "git@github.com:user/repo.git",
    });
    expect(result.modelLabels).toBeUndefined();
  });

  it("rejects invalid jira email", () => {
    expect(() =>
      ProjectConfigSchema.parse({
        repo: "test",
        jiraEmail: "not-an-email",
      }),
    ).toThrow();
  });

  it("accepts valid jiraDomain hostnames", () => {
    for (const domain of [
      "mycompany.atlassian.net",
      "jira.example.com",
      "localhost",
      "a-b.c-d.example.com",
    ]) {
      const result = ProjectConfigSchema.parse({ repo: "test", jiraDomain: domain });
      expect(result.jiraDomain).toBe(domain);
    }
  });

  it("rejects jiraDomain values with path traversal or invalid chars", () => {
    for (const domain of [
      "evil.com/../../",
      "evil.com/path",
      "https://evil.com",
      "evil.com:8080",
      ".leading-dot.com",
      "trailing-dot.com.",
      "-starts-with-dash.com",
      "has spaces.com",
    ]) {
      expect(() =>
        ProjectConfigSchema.parse({ repo: "test", jiraDomain: domain }),
      ).toThrow();
    }
  });
});

describe("ProjectsRegistrySchema", () => {
  it("parses empty registry", () => {
    const result = ProjectsRegistrySchema.parse({});
    expect(result.projects).toEqual([]);
  });

  it("parses registry with projects", () => {
    const result = ProjectsRegistrySchema.parse({
      projects: [
        { path: "/home/user/project-a" },
        { path: "/home/user/project-b" },
      ],
    });
    expect(result.projects).toHaveLength(2);
  });
});
