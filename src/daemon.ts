import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { createLogger } from "./utils/logger";
import { stateFilePath, statsFilePath } from "./config/paths";
import { atomicWriteFileAsync, safeJsonParseAsync } from "./utils/fs";
import { basename } from "node:path";
import { loadGlobalConfig, loadProjectsRegistry, ensureGlobalConfigDir } from "./config/loader";
import { TaskQueue, TaskPriority } from "./core/queue";
import { TaskRunner } from "./core/runner";
import { Poller } from "./core/poller";
import { DispatchLedger } from "./core/ledger";
import { Scheduler } from "./core/scheduler";
import { acquireLock, releaseLock } from "./utils/health";
import { pruneStats } from "./core/cost";
import { pruneEvents } from "./core/events";
import { createDaemonServer, parseJsonBody } from "./utils/daemon-server";
import { TaskSource, type ProjectConfig } from "./config/schema";
import { DAEMON, LIMITS } from "./config/constants";
import { z } from "zod";
import { isScheduledTask, type Task } from "./core/queue";
import type { TaskProvider } from "./providers/types";

const logger = createLogger("daemon");

const RetryRequestSchema = z.object({
	taskId: z.string().min(1).max(200),
	project: z.string().min(1).max(200),
	source: TaskSource.optional(),
});

const CancelRequestSchema = z.object({
	taskId: z.string().min(1).max(200),
});

let shuttingDown = false;
let stateWriteFailures = 0;

let statsCache: { data: { tasks: number; prs: number; failed: number; estimatedCost: number }; timestamp: number } | null = null;

async function createProviderForSource(
	source: string,
	projectConfig: ProjectConfig,
): Promise<TaskProvider | null> {
	switch (source) {
		case "linear":
			if (projectConfig.linearApiKey) {
				const { LinearProvider } = await import("./providers/linear.js");
				return new LinearProvider(projectConfig.linearApiKey);
			}
			return null;
		case "github":
			if (projectConfig.githubToken) {
				const { GitHubProvider } = await import("./providers/github.js");
				return new GitHubProvider(projectConfig.githubToken);
			}
			return null;
		case "jira":
			// TODO: Add JiraProvider once the provider class is implemented
			return null;
		default:
			return null;
	}
}

async function main(): Promise<void> {
	ensureGlobalConfigDir();

	if (!acquireLock()) {
		logger.fatal("Another instance of Pergentic is already running. Run `pergentic stop` to stop it first.");
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
		await pruneEvents(LIMITS.MAX_EVENT_ENTRIES);
		await pruneStats(LIMITS.STATS_RETENTION_DAYS);
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
		if (isScheduledTask(task) && task.payload.scheduleId) {
			scheduler.clearActive(task.payload.scheduleId);
		}

		// Call provider onComplete to update ticket status
		if (meta?.projectConfig && task.payload.source) {
			const provider = await createProviderForSource(task.payload.source, meta.projectConfig);

			if (provider) {
				const projectEntry = loadProjectsRegistry().projects.find(
					(p) => basename(p.path) === task.project,
				);
				const context: import("./providers/types").ProjectContext = {
					name: task.project,
					path: projectEntry?.path ?? "",
					repo: meta.projectConfig.repo,
					branch: meta.projectConfig.branch,
					agent: meta.projectConfig.agent,
					linearTeamId: meta.projectConfig.linearTeamId,
				};

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
		if (isScheduledTask(task) && task.payload.scheduleId) {
			scheduler.clearActive(task.payload.scheduleId);
		}
	});

	// State file update loop
	const stateInterval = setInterval(() => {
		updateState(runner, queue);
	}, DAEMON.STATE_UPDATE_INTERVAL_MS);
	stateInterval.unref();

	// HTTP server with router
	const { server, get, post, abortPending } = createDaemonServer();

	// Handler is intentionally fire-and-forget: the daemon-server API is
	// synchronous (returns void) so we use .then() to write the response
	// once the file read completes. Both branches end with res.end().
	// The signal is used to abort the readFile and abandon the response on
	// shutdown or per-request timeout (slow clients).
	get("/status", (res, signal) => {
		res.setHeader("Content-Type", "application/json");
		const statePath = stateFilePath();
		if (existsSync(statePath)) {
			readFile(statePath, { encoding: "utf-8", signal }).then(
				(data) => {
					try {
						if (!res.headersSent) res.end(data);
					} catch (e) {
						logger.error({ err: e }, "Failed to write /status response");
					}
				},
				(err) => {
					if ((err as NodeJS.ErrnoException)?.code === "ABORT_ERR") return;
					logger.error({ err }, "Failed to read state file for /status");
					try {
						if (!res.headersSent)
							res.end(JSON.stringify({ status: "starting" }));
					} catch (e) {
						logger.error({ err: e }, "Failed to write /status error response");
					}
				},
			).catch((e: unknown) => {
				if ((e as NodeJS.ErrnoException)?.code === "ABORT_ERR") return;
				logger.error({ err: e }, "Unhandled error in /status handler");
			});
		} else {
			try {
				res.end(JSON.stringify({ status: "starting" }));
			} catch (e) {
				logger.error({ err: e }, "Failed to write /status fallback response");
			}
		}
	});

	post("/retry", (body, res) => {
		const data = parseJsonBody(body, RetryRequestSchema, res);
		if (!data) return;
		const { taskId, project, source } = data;
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
	});

	post("/cancel", (body, res) => {
		const data = parseJsonBody(body, CancelRequestSchema, res);
		if (!data) return;
		const cancelled = runner.cancelTask(data.taskId);
		if (cancelled) {
			res.writeHead(200).end("Cancelled");
		} else {
			res.writeHead(404).end("Task not found");
		}
	});

	server.on("error", (err: NodeJS.ErrnoException) => {
		if (err.code === "EADDRINUSE") {
			logger.error(
				{ port: config.statusPort },
				`Port ${config.statusPort} is already in use. Is another daemon instance running?`,
			);
		} else if (err.code === "EACCES") {
			logger.error(
				{ port: config.statusPort },
				`Permission denied binding to port ${config.statusPort}.`,
			);
		} else {
			logger.error({ err }, "Status server failed to start");
		}
		shutdown();
	});

	server.listen(config.statusPort, "127.0.0.1", () => {
		logger.info({ port: config.statusPort }, "Status endpoint listening");
	});

	// Graceful shutdown
	const shutdown = async () => {
		if (shuttingDown) return;
		shuttingDown = true;
		logger.info("Shutting down gracefully...");

		try {
			poller.stop();
			clearInterval(stateInterval);

			await runner.waitForAll(DAEMON.SHUTDOWN_TIMEOUT_MS);

			// Abort any pending HTTP requests before closing the server
			abortPending();

			// Close HTTP server with a 5-second timeout
			await Promise.race([
				new Promise<void>((resolve) => server.close(() => resolve())),
				new Promise<void>((resolve) => {
					setTimeout(() => {
						logger.warn("server.close() timed out, forcing connections closed");
						if (typeof server.closeAllConnections === "function") {
							server.closeAllConnections();
						}
						resolve();
					}, 5000);
				}),
			]);

			updateState(runner, queue);
		} finally {
			releaseLock();
			logger.info("Daemon stopped");
			process.exit(0);
		}
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

	process.on("unhandledRejection", (reason: unknown) => {
		logger.fatal({ err: reason }, "Unhandled promise rejection — initiating graceful shutdown");
		shutdown();
	});

	process.on("uncaughtException", (err: Error) => {
		logger.fatal({ err }, "Uncaught exception — initiating graceful shutdown");
		shutdown();
	});

	// Last-resort lock cleanup on unexpected exit
	process.on("exit", () => {
		releaseLock();
	});

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
		lastUpdated: Date.now(),
	};

	try {
		await atomicWriteFileAsync(stateFilePath(), JSON.stringify(state, null, 2));
		stateWriteFailures = 0;
	} catch (err) {
		stateWriteFailures++;
		if (stateWriteFailures >= 3) {
			logger.warn({ err, consecutiveFailures: stateWriteFailures }, "State file write failing repeatedly — daemon state is stale");
		} else {
			logger.warn({ err }, "Failed to write daemon state file");
		}
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
	if (statsCache && Date.now() - statsCache.timestamp < DAEMON.STATS_CACHE_TTL_MS) {
		return statsCache.data;
	}

	const statsPath = statsFilePath();
	// Use null sentinel to distinguish "file missing" (ENOENT) from "corrupted"
	const raw = await safeJsonParseAsync<{ dailyStats?: Record<string, unknown> } | null>(
		statsPath,
		null,
	);

	if (raw === null) {
		// safeJsonParseAsync returns null for both ENOENT and corrupted JSON.
		// If the file still exists it must be corrupted — delete it so the next
		// stats write from cost.ts starts with a fresh file.
		if (existsSync(statsPath)) {
			logger.warn({ statsPath }, "Corrupted stats file detected, removing for recovery");
			try {
				await unlink(statsPath);
			} catch {
				// File may have been concurrently removed — ignore
			}
		}
		statsCache = { data: DEFAULT_DAILY_STATS, timestamp: Date.now() };
		return DEFAULT_DAILY_STATS;
	}

	const today = new Date().toISOString().slice(0, 10);
	const todayRaw = raw?.dailyStats?.[today];
	const parsed = DailyStatsSchema.safeParse(todayRaw);
	const data = parsed.success ? parsed.data : DEFAULT_DAILY_STATS;
	statsCache = { data, timestamp: Date.now() };
	return data;
}

main().catch((err) => {
	logger.fatal({ err }, "Daemon crashed");
	// releaseLock() is handled by the process 'exit' handler
	process.exit(1);
});
