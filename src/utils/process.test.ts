import { describe, it, expect } from "vitest";
import { buildSafeEnv, spawnAsync } from "./process";

describe("buildSafeEnv", () => {
	it("includes whitelisted env vars", () => {
		const env = buildSafeEnv();
		// PATH should always be present in the environment
		expect(env.PATH).toBeDefined();
	});

	it("excludes non-whitelisted env vars", () => {
		// Set a non-whitelisted var
		process.env.SUPER_SECRET_KEY = "secret";
		const env = buildSafeEnv();
		expect(env.SUPER_SECRET_KEY).toBeUndefined();
		delete process.env.SUPER_SECRET_KEY;
	});

	it("applies overrides on top", () => {
		const env = buildSafeEnv({ ANTHROPIC_API_KEY: "test-key" });
		expect(env.ANTHROPIC_API_KEY).toBe("test-key");
	});

	it("overrides can override whitelisted keys", () => {
		const env = buildSafeEnv({ PATH: "/custom/path" });
		expect(env.PATH).toBe("/custom/path");
	});
});

describe("spawnAsync output capping", () => {
	const TRUNCATION_PREFIX = "[Output truncated to last 8KB]\n";

	it("does not truncate output under 8KB", async () => {
		const result = await spawnAsync("node", ["-e", "process.stdout.write('A'.repeat(100))"]);
		expect(result.stdout).toBe("A".repeat(100));
		expect(result.stdout).not.toContain("[Output truncated");
	});

	it("truncates stdout exceeding 8KB with prefix", async () => {
		const result = await spawnAsync("node", ["-e", "process.stdout.write('A'.repeat(16384))"]);
		expect(result.stdout).toContain(TRUNCATION_PREFIX);
		expect(result.stdout.length).toBeLessThanOrEqual(8192 + TRUNCATION_PREFIX.length);
	});

	it("truncates stderr exceeding 8KB with prefix", async () => {
		const result = await spawnAsync("node", ["-e", "process.stderr.write('B'.repeat(16384))"]);
		expect(result.stderr).toContain(TRUNCATION_PREFIX);
		expect(result.stderr.length).toBeLessThanOrEqual(8192 + TRUNCATION_PREFIX.length);
	});

	it("keeps trailing bytes when truncating", async () => {
		const result = await spawnAsync("node", [
			"-e",
			"process.stdout.write('A'.repeat(8000) + 'Z'.repeat(1000))",
		]);
		expect(result.stdout).toContain(TRUNCATION_PREFIX);
		expect(result.stdout).toContain("Z".repeat(1000));
	});
});
