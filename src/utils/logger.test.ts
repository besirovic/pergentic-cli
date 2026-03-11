import { describe, it, expect } from "vitest";
import pino from "pino";
import { Writable } from "node:stream";
import { redactString } from "./redact";

/**
 * Create a test logger that captures JSON output into an array.
 * Uses the same redact config and serializers as the real logger.
 */
function createTestLogger(): { logger: pino.Logger; lines: string[] } {
	const lines: string[] = [];
	const stream = new Writable({
		write(chunk, _encoding, callback) {
			lines.push(chunk.toString());
			callback();
		},
	});

	const logger = pino(
		{
			level: "info",
			redact: {
				paths: [
					"anthropicApiKey",
					"openaiApiKey",
					"githubToken",
					"linearApiKey",
					"openrouterApiKey",
					"slackBotToken",
					"slackAppToken",
					"err.config.headers.Authorization",
					"req.headers.authorization",
				],
				censor: "[REDACTED]",
			},
			serializers: {
				cmd: (value: unknown) =>
					typeof value === "string" ? redactString(value) : value,
			},
		},
		stream,
	);

	return { logger, lines };
}

describe("logger secret redaction", () => {
	it("redacts anthropicApiKey field", () => {
		const { logger, lines } = createTestLogger();
		logger.info({ anthropicApiKey: "sk-ant-api03-abc123" }, "test");
		const parsed = JSON.parse(lines[0]);
		expect(parsed.anthropicApiKey).toBe("[REDACTED]");
	});

	it("redacts openaiApiKey field", () => {
		const { logger, lines } = createTestLogger();
		logger.info({ openaiApiKey: "sk-proj-abc123xyz" }, "test");
		const parsed = JSON.parse(lines[0]);
		expect(parsed.openaiApiKey).toBe("[REDACTED]");
	});

	it("redacts githubToken field", () => {
		const { logger, lines } = createTestLogger();
		logger.info({ githubToken: "ghp_abc123" }, "test");
		const parsed = JSON.parse(lines[0]);
		expect(parsed.githubToken).toBe("[REDACTED]");
	});

	it("redacts linearApiKey field", () => {
		const { logger, lines } = createTestLogger();
		logger.info({ linearApiKey: "lin_api_abc123" }, "test");
		const parsed = JSON.parse(lines[0]);
		expect(parsed.linearApiKey).toBe("[REDACTED]");
	});

	it("redacts slackBotToken field", () => {
		const { logger, lines } = createTestLogger();
		logger.info({ slackBotToken: "xoxb-123-456" }, "test");
		const parsed = JSON.parse(lines[0]);
		expect(parsed.slackBotToken).toBe("[REDACTED]");
	});

	it("redacts slackAppToken field", () => {
		const { logger, lines } = createTestLogger();
		logger.info({ slackAppToken: "xapp-1-abc123" }, "test");
		const parsed = JSON.parse(lines[0]);
		expect(parsed.slackAppToken).toBe("[REDACTED]");
	});

	it("redacts nested err.config.headers.Authorization", () => {
		const { logger, lines } = createTestLogger();
		logger.info(
			{ err: { config: { headers: { Authorization: "Bearer sk-secret" } } } },
			"test",
		);
		const parsed = JSON.parse(lines[0]);
		expect(parsed.err.config.headers.Authorization).toBe("[REDACTED]");
	});

	it("redacts nested req.headers.authorization", () => {
		const { logger, lines } = createTestLogger();
		logger.info(
			{ req: { headers: { authorization: "Bearer sk-secret" } } },
			"test",
		);
		const parsed = JSON.parse(lines[0]);
		expect(parsed.req.headers.authorization).toBe("[REDACTED]");
	});

	it("serializer redacts cmd field containing a token", () => {
		const { logger, lines } = createTestLogger();
		logger.info({ cmd: "run --token=sk-ant-api03-abc123def456" }, "test");
		const parsed = JSON.parse(lines[0]);
		expect(parsed.cmd).toBe("run --token=***REDACTED***");
		expect(parsed.cmd).not.toContain("sk-ant-");
	});

	it("serializer redacts cmd field with bare token", () => {
		const { logger, lines } = createTestLogger();
		logger.info(
			{ cmd: "deploy ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789" },
			"test",
		);
		const parsed = JSON.parse(lines[0]);
		expect(parsed.cmd).toBe("deploy ***REDACTED***");
	});

	it("serializer preserves non-sensitive cmd", () => {
		const { logger, lines } = createTestLogger();
		logger.info({ cmd: "yarn test --bail" }, "test");
		const parsed = JSON.parse(lines[0]);
		expect(parsed.cmd).toBe("yarn test --bail");
	});

	it("preserves non-secret fields", () => {
		const { logger, lines } = createTestLogger();
		logger.info({ taskId: "task-123", cwd: "/tmp/work" }, "test");
		const parsed = JSON.parse(lines[0]);
		expect(parsed.taskId).toBe("task-123");
		expect(parsed.cwd).toBe("/tmp/work");
	});
});
