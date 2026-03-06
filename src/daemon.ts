import { createServer } from "node:http";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { createLogger } from "./utils/logger";
import { stateFilePath, statsFilePath } from "./config/paths";
import { loadGlobalConfig, ensureGlobalConfigDir } from "./config/loader";
import { TaskQueue } from "./core/queue";
import { TaskRunner } from "./core/runner";
import { Poller } from "./core/poller";
import { DispatchLedger } from "./core/ledger";

const logger = createLogger("daemon");
let shuttingDown = false;

async function main(): Promise<void> {
	ensureGlobalConfigDir();
	const config = loadGlobalConfig();

	logger.info("Pergentic daemon starting");

	// Initialize dispatch ledger (persistent deduplication)
	const ledger = new DispatchLedger();
	ledger.load();

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

	// State file update loop
	const stateInterval = setInterval(() => {
		updateState(runner, queue);
	}, 3000);

	// HTTP status endpoint
	const server = createServer((req, res) => {
		if (req.url === "/status") {
			res.setHeader("Content-Type", "application/json");
			const statePath = stateFilePath();
			if (existsSync(statePath)) {
				res.end(readFileSync(statePath, "utf-8"));
			} else {
				res.end(JSON.stringify({ status: "starting" }));
			}
			return;
		}

		if (req.method === "POST" && req.url === "/retry") {
			let body = "";
			req.on("data", (chunk) => (body += chunk));
			req.on("end", () => {
				try {
					const { taskId } = JSON.parse(body);
					// Re-add task to queue with retry priority
					queue.add({
						id: `retry-${taskId}-${Date.now()}`,
						project: "",
						priority: 3,
						type: "retry",
						createdAt: Date.now(),
						payload: {
							taskId,
							title: `Retry: ${taskId}`,
							description: "",
							source: "github",
						},
					});
					res.writeHead(200).end("OK");
				} catch {
					res.writeHead(400).end("Bad request");
				}
			});
			return;
		}

		if (req.method === "POST" && req.url === "/cancel") {
			let body = "";
			req.on("data", (chunk) => (body += chunk));
			req.on("end", () => {
				try {
					const { taskId } = JSON.parse(body);
					const cancelled = runner.cancelTask(taskId);
					if (cancelled) {
						res.writeHead(200).end("Cancelled");
					} else {
						res.writeHead(404).end("Task not found");
					}
				} catch {
					res.writeHead(400).end("Bad request");
				}
			});
			return;
		}

		res.writeHead(404).end();
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

		// Wait for active tasks (max 5 min)
		await runner.waitForAll(300_000);

		server.close();
		updateState(runner, queue);
		logger.info("Daemon stopped");
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

	// Start polling
	await poller.start();
}

function updateState(runner: TaskRunner, queue: TaskQueue): void {
	const state = {
		status: shuttingDown ? "stopping" : "running",
		uptime: process.uptime(),
		projects: [] as Array<{ name: string; agent: string; status: string }>,
		activeTasks: runner.activeTasks,
		queuedTasks: queue.length,
		todayStats: loadTodayStats(),
	};

	try {
		writeFileSync(stateFilePath(), JSON.stringify(state, null, 2));
	} catch {
		// Ignore write errors
	}
}

function loadTodayStats(): {
	tasks: number;
	prs: number;
	failed: number;
	estimatedCost: number;
} {
	try {
		const statsPath = statsFilePath();
		if (!existsSync(statsPath)) {
			return { tasks: 0, prs: 0, failed: 0, estimatedCost: 0 };
		}
		const stats = JSON.parse(readFileSync(statsPath, "utf-8"));
		const today = new Date().toISOString().slice(0, 10);
		return (
			stats.dailyStats?.[today] ?? {
				tasks: 0,
				prs: 0,
				failed: 0,
				estimatedCost: 0,
			}
		);
	} catch {
		return { tasks: 0, prs: 0, failed: 0, estimatedCost: 0 };
	}
}

main().catch((err) => {
	logger.fatal({ err }, "Daemon crashed");
	process.exit(1);
});
