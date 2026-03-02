import { describe, it, expect } from "vitest";
import { resolveAgent } from "./resolve-agent";

describe("resolveAgent", () => {
  it("resolves claude-code agent", () => {
    const agent = resolveAgent("claude-code");
    expect(agent.name).toBe("claude-code");
    const cmd = agent.buildCommand("test prompt", "/tmp/work");
    expect(cmd.command).toBe("claude");
    expect(cmd.args).toContain("-p");
    expect(cmd.args).toContain("test prompt");
  });

  it("resolves codex agent", () => {
    const agent = resolveAgent("codex");
    expect(agent.name).toBe("codex");
    const cmd = agent.buildCommand("test prompt", "/tmp/work");
    expect(cmd.command).toBe("codex");
  });

  it("resolves aider agent", () => {
    const agent = resolveAgent("aider");
    expect(agent.name).toBe("aider");
    const cmd = agent.buildCommand("test prompt", "/tmp/work");
    expect(cmd.command).toBe("aider");
    expect(cmd.args).toContain("--yes");
  });

  it("resolves opencode agent", () => {
    const agent = resolveAgent("opencode");
    expect(agent.name).toBe("opencode");
    const cmd = agent.buildCommand("test prompt", "/tmp/work");
    expect(cmd.command).toBe("opencode");
  });

  it("resolves mock agent", () => {
    const agent = resolveAgent("mock");
    expect(agent.name).toBe("mock");
    const cmd = agent.buildCommand("test prompt", "/tmp/work");
    expect(cmd.command).toBe("echo");
  });

  it("throws for unknown agent", () => {
    expect(() => resolveAgent("unknown")).toThrow("Unknown agent: unknown");
  });
});
