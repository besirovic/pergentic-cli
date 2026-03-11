import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { isRunning, readPid } from "../utils/health";
import { error } from "../utils/ui";
import { loadGlobalConfig } from "../config/loader";
import { readState, type DaemonState } from "../utils/daemon-state";
import { formatDuration } from "../utils/format";
import { TIMEOUTS } from "../config/constants";

function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = createServer();
		srv.listen(0, () => {
			const port = (srv.address() as { port: number }).port;
			srv.close(() => resolve(port));
		});
		srv.on("error", reject);
	});
}

function formatUptime(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

async function fetchRemoteStatus(remoteName: string): Promise<void> {
	const config = loadGlobalConfig();
	const remote = config.remotes?.[remoteName];
	if (!remote) {
		error(`Remote "${remoteName}" not found in config.`);
		return;
	}

	const localPort = await getFreePort();
	const tunnel = spawn("ssh", [
		"-L",
		`${localPort}:127.0.0.1:${remote.port}`,
		remote.host,
		"-N",
		"-o",
		"ConnectTimeout=5",
	]);

	// Wait for tunnel to establish
	await new Promise((r) => setTimeout(r, TIMEOUTS.SSH_TUNNEL_ESTABLISH_MS));

	try {
		const res = await fetch(`http://localhost:${localPort}/status`);
		const state = (await res.json()) as DaemonState;
		renderStatus(state, remoteName);
	} catch {
		error(`Failed to connect to remote "${remoteName}".`);
	} finally {
		tunnel.kill();
	}
}

function renderStatus(state: DaemonState, label?: string): void {
	const prefix = label ? ` (${label})` : "";
	const icon = state.status === "running" ? "●" : "○";
	console.log(
		`${icon} Pergentic${prefix}: ${state.status} · Uptime ${formatUptime(
			state.uptime
		)} · ${state.projects.length} projects · ${
			state.activeTasks.length
		} active tasks`
	);
	if (state.todayStats) {
		console.log(
			`  Today: ${state.todayStats.tasks} tasks · ${
				state.todayStats.prs
			} PRs · ${
				state.todayStats.failed
			} failed · $${state.todayStats.estimatedCost.toFixed(2)} cost`
		);
	}
}

export async function status(opts: { remote?: string }): Promise<void> {
	if (opts.remote) {
		await fetchRemoteStatus(opts.remote);
		return;
	}

	if (!isRunning()) {
		console.log("○ Pergentic: stopped");
		return;
	}

	const state = readState();
	if (!state) {
		const pid = readPid();
		console.log(`● Pergentic: running (PID: ${pid}) — no state data yet`);
		return;
	}

	renderStatus(state);
}
