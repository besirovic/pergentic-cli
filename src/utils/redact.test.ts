import { describe, it, expect } from "vitest";
import { redactArgs } from "./redact";

describe("redactArgs", () => {
	it("redacts Anthropic API keys (sk-ant-*)", () => {
		const args = ["--api-key", "sk-ant-api03-abc123def456"];
		expect(redactArgs(args)).toEqual(["--api-key", "***REDACTED***"]);
	});

	it("redacts OpenAI API keys (sk-*)", () => {
		const args = ["--key", "sk-proj-abcdefghijklmnopqrstuvwxyz"];
		expect(redactArgs(args)).toEqual(["--key", "***REDACTED***"]);
	});

	it("redacts GitHub personal access tokens (ghp_*)", () => {
		const args = ["sk-ant-api03-xyz", "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789"];
		expect(redactArgs(args)).toEqual(["***REDACTED***", "***REDACTED***"]);
	});

	it("redacts GitHub OAuth tokens (gho_*)", () => {
		expect(redactArgs(["gho_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789"])).toEqual(["***REDACTED***"]);
	});

	it("redacts GitHub fine-grained PATs (github_pat_*)", () => {
		expect(redactArgs(["github_pat_abcdefghijklmnopqrstuvw"])).toEqual(["***REDACTED***"]);
	});

	it("redacts Linear API keys (lin_api_*)", () => {
		expect(redactArgs(["lin_api_abcdefghijklmnopqrstuvwxyz01234"])).toEqual(["***REDACTED***"]);
	});

	it("redacts Slack bot tokens (xoxb-*)", () => {
		expect(redactArgs(["xoxb-123-456-abc"])).toEqual(["***REDACTED***"]);
	});

	it("redacts Slack user tokens (xoxp-*)", () => {
		expect(redactArgs(["xoxp-123-456-abc"])).toEqual(["***REDACTED***"]);
	});

	it("redacts OpenRouter API keys (sk-or-v1-*)", () => {
		expect(redactArgs(["sk-or-v1-" + "a".repeat(40)])).toEqual(["***REDACTED***"]);
	});

	it("preserves non-sensitive args", () => {
		const args = ["--print", "/tmp/worktree/src", "--flag", "hello-world"];
		expect(redactArgs(args)).toEqual(args);
	});

	it("does not redact short sk- strings that are not real keys", () => {
		expect(redactArgs(["sk-short"])).toEqual(["sk-short"]);
	});

	it("handles empty array", () => {
		expect(redactArgs([])).toEqual([]);
	});

	it("handles mixed sensitive and non-sensitive args", () => {
		const args = ["claude", "--api-key", "sk-ant-api03-secret123", "--cwd", "/tmp/work"];
		const result = redactArgs(args);
		expect(result).toEqual(["claude", "--api-key", "***REDACTED***", "--cwd", "/tmp/work"]);
	});
});
