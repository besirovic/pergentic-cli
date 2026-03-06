import { describe, it, expect } from "vitest";
import type { ProjectConfig } from "../config/schema";
import { validateLabels } from "./validate-labels";

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    repo: "git@github.com:user/repo.git",
    branch: "main",
    agent: "claude-code",
    configuredAgents: ["claude-code", "aider", "codex"],
    ...overrides,
  } as ProjectConfig;
}

describe("validateLabels", () => {
  it("returns no errors for clean config", () => {
    const config = makeConfig({
      agentLabels: { "claude-code": ["use-claude"] },
      modelLabels: { "claude-code": { "claude-opus": "claude-opus-4-20250514" } },
    });
    expect(validateLabels(config)).toEqual([]);
  });

  it("returns no errors when neither agentLabels nor modelLabels configured", () => {
    const config = makeConfig();
    expect(validateLabels(config)).toEqual([]);
  });

  it("returns no errors when only agentLabels configured", () => {
    const config = makeConfig({
      agentLabels: { "claude-code": ["use-claude"], aider: ["use-aider"] },
    });
    expect(validateLabels(config)).toEqual([]);
  });

  it("detects conflict between agentLabels and modelLabels", () => {
    const config = makeConfig({
      agentLabels: { "claude-code": ["claude-opus"] },
      modelLabels: { "claude-code": { "claude-opus": "claude-opus-4-20250514" } },
    });
    const errors = validateLabels(config);
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe("conflict");
    expect(errors[0].label).toBe("claude-opus");
  });

  it("detects duplicate label across agents in modelLabels", () => {
    const config = makeConfig({
      modelLabels: {
        "claude-code": { "use-opus": "claude-opus-4-20250514" },
        aider: { "use-opus": "anthropic/claude-opus-4-20250514" },
      },
    });
    const errors = validateLabels(config);
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe("duplicate");
    expect(errors[0].label).toBe("use-opus");
  });

  it("skips unconfigured agents in modelLabels", () => {
    const config = makeConfig({
      configuredAgents: ["claude-code"],
      modelLabels: {
        "claude-code": { "claude-opus": "claude-opus-4-20250514" },
        codex: { "claude-opus": "gpt-4.1" }, // codex not configured, should be skipped
      },
    });
    const errors = validateLabels(config);
    expect(errors).toEqual([]);
  });

  it("detects conflict case-insensitively", () => {
    const config = makeConfig({
      agentLabels: { "claude-code": ["Claude-Opus"] },
      modelLabels: { "claude-code": { "claude-opus": "claude-opus-4-20250514" } },
    });
    const errors = validateLabels(config);
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe("conflict");
  });
});
