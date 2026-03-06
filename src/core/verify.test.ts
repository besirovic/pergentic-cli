import { describe, it, expect } from "vitest";
import { buildVerificationFixPrompt, execCommand } from "./verify";

describe("buildVerificationFixPrompt", () => {
	it("includes command and attempt info", () => {
		const prompt = buildVerificationFixPrompt("npm test", "Error: test failed", 1, 3);
		expect(prompt).toContain("`npm test`");
		expect(prompt).toContain("1 of 3");
		expect(prompt).toContain("Error: test failed");
	});

	it("truncates long output with indicator", () => {
		const longOutput = "x".repeat(5000);
		const prompt = buildVerificationFixPrompt("npm test", longOutput, 1, 3);
		expect(prompt).toContain("[Output truncated to last 3000 chars]");
		expect(prompt.length).toBeLessThan(5000);
	});

	it("does not truncate short output", () => {
		const shortOutput = "short error";
		const prompt = buildVerificationFixPrompt("npm test", shortOutput, 1, 3);
		expect(prompt).not.toContain("[Output truncated");
		expect(prompt).toContain("short error");
	});
});

describe("execCommand", () => {
	it("returns success for successful command", async () => {
		const result = await execCommand("echo hello", "/tmp", {});
		expect(result.success).toBe(true);
		expect(result.output).toContain("hello");
	});

	it("returns failure for failing command", async () => {
		const result = await execCommand("exit 1", "/tmp", {});
		expect(result.success).toBe(false);
	});

	it("captures stderr output", async () => {
		const result = await execCommand("echo err >&2", "/tmp", {});
		expect(result.output).toContain("err");
	});
});
