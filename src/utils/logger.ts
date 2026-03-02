import pino from "pino";
import { daemonLogPath } from "../config/paths";

export type LogMode = "cli" | "daemon";

export function createLogger(mode: LogMode = "cli"): pino.Logger {
	const level = process.env.PERGENTIC_LOG_LEVEL ?? "info";

	if (mode === "daemon") {
		return pino(
			{ level },
			pino.destination({ dest: daemonLogPath(), sync: false })
		);
	}

	return pino({
		level,
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
