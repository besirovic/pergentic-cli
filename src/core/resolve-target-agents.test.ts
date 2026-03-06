import { describe, it, expect } from "vitest";
import type { ProjectConfig } from "../config/schema";
import { resolveTargetAgents, resolveTargetAgentsWithModels } from "./resolve-target-agents";

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    repo: "git@github.com:user/repo.git",
    branch: "main",
    agent: "claude-code",
    configuredAgents: ["claude-code", "aider", "codex"],
    ...overrides,
  } as ProjectConfig;
}

describe("resolveTargetAgents", () => {
  it("returns default agent when no labels", () => {
    const config = makeConfig();
    expect(resolveTargetAgents([], config)).toEqual(["claude-code"]);
  });

  it("returns default agent when no agentLabels configured", () => {
    const config = makeConfig();
    expect(resolveTargetAgents(["some-label"], config)).toEqual(["claude-code"]);
  });

  it("matches agent labels case-insensitively", () => {
    const config = makeConfig({
      agentLabels: { aider: ["Use-Aider"] },
    });
    expect(resolveTargetAgents(["use-aider"], config)).toEqual(["aider"]);
  });
});

describe("resolveTargetAgentsWithModels", () => {
  it("returns default agent with no model when no labels", () => {
    const config = makeConfig();
    const result = resolveTargetAgentsWithModels([], config);
    expect(result).toEqual([{ agent: "claude-code" }]);
  });

  it("returns default agent when no label config", () => {
    const config = makeConfig();
    const result = resolveTargetAgentsWithModels(["some-label"], config);
    expect(result).toEqual([{ agent: "claude-code" }]);
  });

  it("matches agent labels without model", () => {
    const config = makeConfig({
      agentLabels: { aider: ["use-aider"] },
    });
    const result = resolveTargetAgentsWithModels(["use-aider"], config);
    expect(result).toEqual([{ agent: "aider" }]);
  });

  it("matches model labels and implicitly selects agent", () => {
    const config = makeConfig({
      modelLabels: {
        "claude-code": { "claude-opus": "claude-opus-4-20250514" },
      },
    });
    const result = resolveTargetAgentsWithModels(["claude-opus"], config);
    expect(result).toEqual([
      { agent: "claude-code", model: "claude-opus-4-20250514", modelLabel: "claude-opus" },
    ]);
  });

  it("handles multiple model labels for one agent → one target per model", () => {
    const config = makeConfig({
      modelLabels: {
        "claude-code": {
          "claude-opus": "claude-opus-4-20250514",
          "claude-sonnet": "claude-sonnet-4-20250514",
        },
      },
    });
    const result = resolveTargetAgentsWithModels(["claude-opus", "claude-sonnet"], config);
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({
      agent: "claude-code", model: "claude-opus-4-20250514", modelLabel: "claude-opus",
    });
    expect(result).toContainEqual({
      agent: "claude-code", model: "claude-sonnet-4-20250514", modelLabel: "claude-sonnet",
    });
  });

  it("merges agent labels and model labels — model targets take precedence", () => {
    const config = makeConfig({
      agentLabels: { "claude-code": ["use-claude"], aider: ["use-aider"] },
      modelLabels: {
        "claude-code": { "claude-opus": "claude-opus-4-20250514" },
      },
    });
    const result = resolveTargetAgentsWithModels(
      ["use-claude", "use-aider", "claude-opus"],
      config,
    );
    // claude-code matched by both agentLabels and modelLabels → model target wins
    // aider matched by agentLabels only → no model
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({
      agent: "claude-code", model: "claude-opus-4-20250514", modelLabel: "claude-opus",
    });
    expect(result).toContainEqual({ agent: "aider" });
  });

  it("skips model labels for unconfigured agents", () => {
    const config = makeConfig({
      configuredAgents: ["claude-code"],
      modelLabels: {
        "claude-code": { "claude-opus": "claude-opus-4-20250514" },
        codex: { "gpt-4.1": "gpt-4.1" },
      },
    });
    const result = resolveTargetAgentsWithModels(["claude-opus", "gpt-4.1"], config);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      agent: "claude-code", model: "claude-opus-4-20250514", modelLabel: "claude-opus",
    });
  });

  it("falls back to default agent when no labels match", () => {
    const config = makeConfig({
      agentLabels: { aider: ["use-aider"] },
      modelLabels: { "claude-code": { "claude-opus": "claude-opus-4-20250514" } },
    });
    const result = resolveTargetAgentsWithModels(["unrelated-label"], config);
    expect(result).toEqual([{ agent: "claude-code" }]);
  });

  it("matches model labels case-insensitively", () => {
    const config = makeConfig({
      modelLabels: {
        "claude-code": { "Claude-Opus": "claude-opus-4-20250514" },
      },
    });
    const result = resolveTargetAgentsWithModels(["claude-opus"], config);
    expect(result).toEqual([
      { agent: "claude-code", model: "claude-opus-4-20250514", modelLabel: "Claude-Opus" },
    ]);
  });
});
