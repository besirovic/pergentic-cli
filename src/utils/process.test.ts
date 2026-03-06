import { describe, it, expect } from "vitest";
import { buildSafeEnv } from "./process";

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
