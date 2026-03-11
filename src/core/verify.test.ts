import { describe, it, expect } from "vitest";
import {
	buildVerificationFixPrompt,
	execCommand,
	spawnAgentAndWait,
} from "./verify";

describe("buildVerificationFixPrompt", () => {
	it("includes command and attempt info", () => {
		const prompt = buildVerificationFixPrompt(
			"yarn test",
			"Error: test failed",
			1,
			3,
		);
		expect(prompt).toContain("`yarn test`");
		expect(prompt).toContain("1 of 3");
		expect(prompt).toContain("Error: test failed");
	});

	it("truncates long output with indicator", () => {
		const longOutput = "x".repeat(5000);
		const prompt = buildVerificationFixPrompt("yarn test", longOutput, 1, 3);
		expect(prompt).toContain("[Output truncated to last 3000 chars]");
		expect(prompt.length).toBeLessThan(5000);
	});

	it("does not truncate short output", () => {
		const shortOutput = "short error";
		const prompt = buildVerificationFixPrompt("yarn test", shortOutput, 1, 3);
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

	it("sets timedOut to false on normal completion", async () => {
		const result = await execCommand("echo ok", "/tmp", {});
		expect(result.timedOut).toBe(false);
	});

	it("kills command and sets timedOut on timeout", async () => {
		const result = await execCommand("sleep 60", "/tmp", {}, 200);
		expect(result.timedOut).toBe(true);
		expect(result.success).toBe(false);
		expect(result.output).toContain("timed out");
	}, 10_000);

	it("resolves when child is killed by external signal", async () => {
		// 'kill -9 $$' causes the sh process to send SIGKILL to itself.
		// The promise must resolve (not hang) and report failure.
		const result = await execCommand("kill -9 $$", "/tmp", {});
		expect(result.success).toBe(false);
		expect(result.timedOut).toBe(false);
	}, 5_000);
});

describe("spawnAgentAndWait output buffering", () => {
	const TRUNCATION_PREFIX = "[Output truncated to last 8KB]\n";
	const MAX_OUTPUT = 8192;

	it("truncates stdout from a single large chunk to MAX_OUTPUT", async () => {
		// Generate 16KB of output in a single write (exceeds 8192 MAX_OUTPUT)
		const handle = spawnAgentAndWait(
			{
				command: "node",
				args: ["-e", "process.stdout.write('A'.repeat(16384))"],
			},
			"/tmp",
			{},
		);
		const result = await handle.result;
		expect(result.stdout).toContain(TRUNCATION_PREFIX);
		// Buffer truncated to 8192 + prefix
		expect(result.stdout.length).toBeLessThanOrEqual(
			MAX_OUTPUT + TRUNCATION_PREFIX.length,
		);
	});

	it("truncates stderr from a single large chunk to MAX_OUTPUT", async () => {
		const handle = spawnAgentAndWait(
			{
				command: "node",
				args: ["-e", "process.stderr.write('B'.repeat(16384))"],
			},
			"/tmp",
			{},
		);
		const result = await handle.result;
		expect(result.stderr).toContain(TRUNCATION_PREFIX);
		expect(result.stderr.length).toBeLessThanOrEqual(
			MAX_OUTPUT + TRUNCATION_PREFIX.length,
		);
	});

	it("keeps the tail (most recent) bytes when truncating", async () => {
		// Write 'A' * 8000 + 'Z' * 1000 = 9000 bytes; after truncation we should see only 'Z's at the end
		const handle = spawnAgentAndWait(
			{
				command: "node",
				args: [
					"-e",
					"process.stdout.write('A'.repeat(8000) + 'Z'.repeat(1000))",
				],
			},
			"/tmp",
			{},
		);
		const result = await handle.result;
		expect(result.stdout).toMatch(/Z{1000}$/);
	});

	it("truncates correctly with multiple small chunks accumulating beyond MAX_OUTPUT", async () => {
		// Write 100 chunks of 100 bytes = 10000 bytes total via many writes
		const script = `
			for (let i = 0; i < 100; i++) {
				process.stdout.write('A'.repeat(100));
			}
		`;
		const handle = spawnAgentAndWait(
			{ command: "node", args: ["-e", script] },
			"/tmp",
			{},
		);
		const result = await handle.result;
		expect(result.stdout).toContain(TRUNCATION_PREFIX);
		// After prefix, the content should be at most MAX_OUTPUT chars
		const content = result.stdout.replace(TRUNCATION_PREFIX, "");
		expect(content.length).toBeLessThanOrEqual(MAX_OUTPUT);
	});

	it("keeps exactly MAX_OUTPUT tail bytes when large old chunk followed by small new chunk", async () => {
		// Write 8000 'A' bytes then 193 'Z' bytes = 8193 total (just over MAX_OUTPUT).
		// The last MAX_OUTPUT bytes should include all 193 Z's and 7999 A's.
		const script = `
			process.stdout.write('A'.repeat(8000));
			process.stdout.write('Z'.repeat(193));
		`;
		const handle = spawnAgentAndWait(
			{ command: "node", args: ["-e", script] },
			"/tmp",
			{},
		);
		const result = await handle.result;
		// Truncation should have occurred
		expect(result.stdout).toContain(TRUNCATION_PREFIX);
		const content = result.stdout.replace(TRUNCATION_PREFIX, "").trim();
		// All 193 Z's must be present at the end
		expect(content).toMatch(/Z{193}$/);
		// Content length should be exactly MAX_OUTPUT (after trim, accounting for no trailing newline)
		expect(content.length).toBe(MAX_OUTPUT);
	});

	it("does not truncate output of exactly MAX_OUTPUT bytes", async () => {
		// Write exactly 8192 bytes — should not trigger truncation
		const handle = spawnAgentAndWait(
			{
				command: "node",
				args: ["-e", `process.stdout.write('X'.repeat(${MAX_OUTPUT}))`],
			},
			"/tmp",
			{},
		);
		const result = await handle.result;
		expect(result.stdout).not.toContain(TRUNCATION_PREFIX);
		expect(result.stdout).toBe("X".repeat(MAX_OUTPUT));
	});

	it("does not truncate output below MAX_OUTPUT", async () => {
		const handle = spawnAgentAndWait(
			{ command: "node", args: ["-e", "process.stdout.write('hello')"] },
			"/tmp",
			{},
		);
		const result = await handle.result;
		expect(result.stdout).not.toContain(TRUNCATION_PREFIX);
		expect(result.stdout).toBe("hello");
	});
});
