import { describe, it, expect } from "vitest";
import { claudeCode } from "./claude-code";
import { aider } from "./aider";
import { opencode } from "./opencode";
import { codex } from "./codex";

// '€' = 3 bytes but 1 char. 22000 repetitions = 66000 bytes (> 64KB) but 22000 chars (< 64KB).
// This tests that Buffer.byteLength() is used instead of string.length.
const MULTI_BYTE_LARGE = "€".repeat(22000); // 66000 bytes, 22000 chars

describe("agent byte length validation uses Buffer.byteLength()", () => {
  it("claude-code: rejects multi-byte model arg exceeding 64KB by byte count", () => {
    // 22000 chars of '€' = 66000 bytes; old code (string.length) would not throw
    expect(() =>
      claudeCode.buildCommand("x", "/tmp/work", { model: MULTI_BYTE_LARGE })
    ).toThrow(/exceed 64KB limit/);
  });

  it("aider: rejects multi-byte model arg exceeding 64KB by byte count", () => {
    expect(() =>
      aider.buildCommand("x", "/tmp/work", { model: MULTI_BYTE_LARGE })
    ).toThrow(/exceed 64KB limit/);
  });

  it("opencode: rejects multi-byte model arg exceeding 64KB by byte count", () => {
    expect(() =>
      opencode.buildCommand("x", "/tmp/work", { model: MULTI_BYTE_LARGE })
    ).toThrow(/exceed 64KB limit/);
  });

  it("codex: rejects multi-byte model arg exceeding 64KB by byte count", () => {
    expect(() =>
      codex.buildCommand("x", "/tmp/work", { model: MULTI_BYTE_LARGE })
    ).toThrow(/exceed 64KB limit/);
  });

  it("accepts args well within 64KB", () => {
    expect(() => claudeCode.buildCommand("Hello", "/tmp/work")).not.toThrow();
    expect(() => aider.buildCommand("Hello", "/tmp/work")).not.toThrow();
    expect(() => opencode.buildCommand("Hello", "/tmp/work")).not.toThrow();
    expect(() => codex.buildCommand("Hello", "/tmp/work")).not.toThrow();
  });

  it("multi-byte string byte count exceeds char count", () => {
    expect(Buffer.byteLength(MULTI_BYTE_LARGE)).toBe(66000);
    expect(MULTI_BYTE_LARGE.length).toBe(22000);
    expect(Buffer.byteLength(MULTI_BYTE_LARGE)).toBeGreaterThan(64 * 1024);
    expect(MULTI_BYTE_LARGE.length).toBeLessThan(64 * 1024);
  });
});
