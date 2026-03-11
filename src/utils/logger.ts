import pino from "pino";
import { daemonLogPath } from "../config/paths";
import { redactString } from "./redact";

export type LogMode = "cli" | "daemon";

const redactConfig: pino.LoggerOptions["redact"] = {
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
};

const serializers: pino.LoggerOptions["serializers"] = {
	cmd: (value: unknown) =>
		typeof value === "string" ? redactString(value) : value,
};

export function createLogger(mode: LogMode = "cli"): pino.Logger {
	const level = process.env.PERGENTIC_LOG_LEVEL ?? "info";

	if (mode === "daemon") {
		return pino(
			{ level, redact: redactConfig, serializers },
			pino.destination({ dest: daemonLogPath(), sync: false })
		);
	}

	return pino({
		level,
		redact: redactConfig,
		serializers,
		transport: {
			target: "pino-pretty",
			options: {
				destination: 2, // stderr
				colorize: true,
				translateTime: "HH:MM:ss",
				ignore: "pid,hostname",
			},
		},
	});
}

export const logger = createLogger("cli");
