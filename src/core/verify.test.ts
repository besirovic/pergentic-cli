import { describe, it, expect } from "vitest";
import { buildVerificationFixPrompt, execCommand, spawnAgentAndWait } from "./verify";

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

describe("spawnAgentAndWait output buffering", () => {
	it("truncates stdout from a single large chunk to MAX_OUTPUT", async () => {
		const TRUNCATION_PREFIX = "[Output truncated to last 8KB]\n";
		// Generate 16KB of output in a single write (exceeds 8192 MAX_OUTPUT)
		const handle = spawnAgentAndWait(
			{ command: "node", args: ["-e", "process.stdout.write('A'.repeat(16384))"] },
			"/tmp",
			{},
		);
		const result = await handle.result;
		expect(result.stdout).toContain(TRUNCATION_PREFIX);
		// Buffer truncated to 8192 + prefix
		expect(result.stdout.length).toBeLessThanOrEqual(8192 + TRUNCATION_PREFIX.length);
	});

	it("truncates stderr from a single large chunk to MAX_OUTPUT", async () => {
		const TRUNCATION_PREFIX = "[Output truncated to last 8KB]\n";
		const handle = spawnAgentAndWait(
			{ command: "node", args: ["-e", "process.stderr.write('B'.repeat(16384))"] },
			"/tmp",
			{},
		);
		const result = await handle.result;
		expect(result.stderr).toContain(TRUNCATION_PREFIX);
		expect(result.stderr.length).toBeLessThanOrEqual(8192 + TRUNCATION_PREFIX.length);
	});

	it("keeps the tail (most recent) bytes when truncating", async () => {
		// Write 'A' * 8000 + 'Z' * 1000 = 9000 bytes; after truncation we should see only 'Z's at the end
		const handle = spawnAgentAndWait(
			{ command: "node", args: ["-e", "process.stdout.write('A'.repeat(8000) + 'Z'.repeat(1000))"] },
			"/tmp",
			{},
		);
		const result = await handle.result;
		expect(result.stdout).toMatch(/Z{1000}$/);
	});
});
