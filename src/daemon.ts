import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createLogger } from "./utils/logger";
import { stateFilePath, statsFilePath } from "./config/paths";
import { atomicWriteFileAsync } from "./utils/fs";
import { basename } from "node:path";
import { loadGlobalConfig, loadProjectsRegistry, ensureGlobalConfigDir } from "./config/loader";
import { TaskQueue, TaskPriority } from "./core/queue";
import { TaskRunner } from "./core/runner";
import { Poller } from "./core/poller";
import { DispatchLedger } from "./core/ledger";
import { Scheduler } from "./core/scheduler";
import { acquireLock, releaseLock } from "./utils/health";
import { pruneStats, STATS_RETENTION_DAYS } from "./core/cost";
import { pruneEvents, MAX_EVENT_ENTRIES } from "./core/events";
import { createDaemonServer } from "./utils/daemon-server";
import { TaskSource } from "./config/schema";
import { z } from "zod";
import type { Task } from "./core/queue";

const logger = createLogger("daemon");

const RetryRequestSchema = z.object({
	taskId: z.string().min(1).max(200),
	project: z.string().min(1).max(200),
	source: TaskSource.optional(),
});

const CancelRequestSchema = z.object({
	taskId: z.string().min(1).max(200),
});

const STATE_UPDATE_INTERVAL_MS = 3000;
const SHUTDOWN_TIMEOUT_MS = 300_000;
let shuttingDown = false;

async function main(): Promise<void> {
	ensureGlobalConfigDir();

	if (!acquireLock()) {
		logger.fatal("Another instance of Pergentic is already running. Exiting.");
		console.error("Error: Another instance of Pergentic is already running.");
		console.error("Run `pergentic stop` to stop it first.");
		process.exit(1);
	}

	const config = loadGlobalConfig();

	logger.info("Pergentic daemon starting");

	// Initialize dispatch ledger (persistent deduplication)
	const ledger = new DispatchLedger();
	await ledger.load();

	// Prune old data at startup
	try {
		await ledger.prune(30);
		await pruneEvents(MAX_EVENT_ENTRIES);
		await pruneStats(STATS_RETENTION_DAYS);
	} catch (err) {
		logger.warn({ err }, "Failed to prune old data");
	}

	// Initialize queue and runner
	const queue = new TaskQueue();
	const runner = new TaskRunner({
		maxConcurrent: config.maxConcurrent,
		globalConfig: config,
	});

	// Initialize poller
	const poller = new Poller(queue, runner, {
		pollInterval: config.pollInterval,
	}, ledger);

	// Initialize scheduler and wire to poller
	const scheduler = new Scheduler(queue, runner);
	poller.setAfterPollHook(() => scheduler.checkDue());

	// Call provider onComplete when tasks complete, and clear scheduler active set
	runner.on("taskCompleted", async (task: Task, meta) => {
		if (task.type === "scheduled" && "scheduleId" in task.payload && task.payload.scheduleId) {
			scheduler.clearActive(task.payload.scheduleId);
		}

		// Call provider onComplete to update ticket status
		if (meta?.projectConfig && task.payload.source) {
			const projectConfig = meta.projectConfig;
			const providers: import("./providers/types").TaskProvider[] = [];

			if (task.payload.source === "linear" && projectConfig.linearApiKey) {
				const { LinearProvider } = await import("./providers/linear.js");
				providers.push(new LinearProvider(projectConfig.linearApiKey));
			}

			const projectEntry = loadProjectsRegistry().projects.find(
				(p) => basename(p.path) === task.project,
			);
			const context: import("./providers/types").ProjectContext = {
				name: task.project,
				path: projectEntry?.path ?? "",
				repo: projectConfig.repo,
				branch: projectConfig.branch,
				agent: projectConfig.agent,
				linearTeamId: projectConfig.linearTeamId,
			};

			for (const provider of providers) {
				try {
					await provider.onComplete(context, task.payload.taskId, {
						taskId: task.payload.taskId,
						status: "completed",
						duration: meta.duration,
						estimatedCost: 0,
					});
				} catch (err) {
					logger.warn({ err, provider: provider.name, taskId: task.id }, "Provider onComplete failed");
				}
			}
		}
	});
	runner.on("taskFailed", (task: Task) => {
		if (task.type === "scheduled" && "scheduleId" in task.payload && task.payload.scheduleId) {
			scheduler.clearActive(task.payload.scheduleId);
		}
	});

	// State file update loop
	const stateInterval = setInterval(() => {
		updateState(runner, queue);
	}, STATE_UPDATE_INTERVAL_MS);

	// HTTP server with router
	const { server, get, post } = createDaemonServer();

	// Handler is intentionally fire-and-forget: the daemon-server API is
	// synchronous (returns void) so we use .then() to write the response
	// once the file read completes. Both branches end with res.end().
	get("/status", (res) => {
		res.setHeader("Content-Type", "application/json");
		const statePath = stateFilePath();
		if (existsSync(statePath)) {
			readFile(statePath, "utf-8").then(
				(data) => res.end(data),
				() => res.end(JSON.stringify({ status: "starting" })),
			);
		} else {
			res.end(JSON.stringify({ status: "starting" }));
		}
	});

	post("/retry", (body, res) => {
		try {
			const parsed = RetryRequestSchema.safeParse(JSON.parse(body));
			if (!parsed.success) {
				res.writeHead(400, { "Content-Type": "application/json" }).end(
					JSON.stringify({ error: parsed.error.issues.map((i) => i.message).join("; ") }),
				);
				return;
			}
			const { taskId, project, source } = parsed.data;
			queue.add({
				id: `retry-${taskId}-${Date.now()}`,
				project,
				priority: TaskPriority.RETRY,
				type: "retry",
				createdAt: Date.now(),
				payload: {
					taskId,
					title: `Retry: ${taskId}`,
					description: "",
					source: source ?? "github",
				},
			});
			res.writeHead(200).end("OK");
		} catch {
			res.writeHead(400, { "Content-Type": "application/json" }).end(
				JSON.stringify({ error: "Invalid JSON" }),
			);
		}
	});

	post("/cancel", (body, res) => {
		try {
			const parsed = CancelRequestSchema.safeParse(JSON.parse(body));
			if (!parsed.success) {
				res.writeHead(400, { "Content-Type": "application/json" }).end(
					JSON.stringify({ error: parsed.error.issues.map((i) => i.message).join("; ") }),
				);
				return;
			}
			const cancelled = runner.cancelTask(parsed.data.taskId);
			if (cancelled) {
				res.writeHead(200).end("Cancelled");
			} else {
				res.writeHead(404).end("Task not found");
			}
		} catch {
			res.writeHead(400, { "Content-Type": "application/json" }).end(
				JSON.stringify({ error: "Invalid JSON" }),
			);
		}
	});

	server.listen(config.statusPort, "127.0.0.1", () => {
		logger.info({ port: config.statusPort }, "Status endpoint listening");
	});

	// Graceful shutdown
	const shutdown = async () => {
		if (shuttingDown) return;
		shuttingDown = true;
		logger.info("Shutting down gracefully...");

		poller.stop();
		clearInterval(stateInterval);

		await runner.waitForAll(SHUTDOWN_TIMEOUT_MS);

		server.close();
		updateState(runner, queue);
		releaseLock();
		logger.info("Daemon stopped");
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

	// Start polling
	await poller.start();
}

async function updateState(runner: TaskRunner, queue: TaskQueue): Promise<void> {
	const state = {
		status: shuttingDown ? "stopping" : "running",
		uptime: process.uptime(),
		projects: [] as Array<{ name: string; agent: string; status: string }>,
		activeTasks: runner.activeTasks,
		queuedTasks: queue.length,
		todayStats: await loadTodayStats(),
	};

	try {
		await atomicWriteFileAsync(stateFilePath(), JSON.stringify(state, null, 2));
	} catch (err) {
		logger.warn({ err }, "Failed to write daemon state file");
	}
}

const DailyStatsSchema = z.object({
	tasks: z.number().default(0),
	prs: z.number().default(0),
	failed: z.number().default(0),
	estimatedCost: z.number().default(0),
});

const DEFAULT_DAILY_STATS = { tasks: 0, prs: 0, failed: 0, estimatedCost: 0 };

async function loadTodayStats(): Promise<{
	tasks: number;
	prs: number;
	failed: number;
	estimatedCost: number;
}> {
	try {
		const statsPath = statsFilePath();
		if (!existsSync(statsPath)) {
			return DEFAULT_DAILY_STATS;
		}
		const raw = JSON.parse(await readFile(statsPath, "utf-8"));
		const today = new Date().toISOString().slice(0, 10);
		const todayRaw = raw?.dailyStats?.[today];
		const parsed = DailyStatsSchema.safeParse(todayRaw);
		return parsed.success ? parsed.data : DEFAULT_DAILY_STATS;
	} catch {
		return DEFAULT_DAILY_STATS;
	}
}

main().catch((err) => {
	logger.fatal({ err }, "Daemon crashed");
	releaseLock();
	process.exit(1);
});
