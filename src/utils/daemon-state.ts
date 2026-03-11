import { readFileSync } from "node:fs";
import { z } from "zod";
import { stateFilePath } from "../config/paths";
import { logger } from "./logger";

const DaemonStateSchema = z.object({
	status: z.string().default("unknown"),
	uptime: z.number().default(0),
	projects: z
		.array(
			z.object({
				name: z.string(),
				agent: z.string(),
				status: z.string(),
				lastActivity: z.string().optional(),
			})
		)
		.default([]),
	activeTasks: z.array(z.unknown()).default([]),
	queuedTasks: z.number().optional(),
	todayStats: z
		.object({
			tasks: z.number().default(0),
			prs: z.number().default(0),
			failed: z.number().default(0),
			estimatedCost: z.number().default(0),
		})
		.default({}),
});

export type DaemonState = z.infer<typeof DaemonStateSchema>;

export function readState(): DaemonState | null {
	const path = stateFilePath();
	let raw: string;
	try {
		raw = readFileSync(path, "utf-8");
	} catch (err: unknown) {
		if (err instanceof Error && "code" in err && err.code === "ENOENT") {
			return null;
		}
		logger.warn({ err, path }, "Failed to read daemon state file");
		return null;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err: unknown) {
		logger.warn({ err, path }, "Corrupt daemon state file, ignoring");
		return null;
	}

	const result = DaemonStateSchema.safeParse(parsed);
	if (!result.success) {
		logger.warn(
			{ errors: result.error.format(), path },
			"Daemon state file failed validation"
		);
		return null;
	}
	return result.data;
}
