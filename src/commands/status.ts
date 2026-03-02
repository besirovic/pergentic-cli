import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { isRunning, readPid } from "../utils/health";
import { stateFilePath } from "../config/paths";
import { loadGlobalConfig } from "../config/loader";

interface DaemonState {
	status: string;
	uptime: number;
	projects: Array<{
		name: string;
		agent: string;
		status: string;
		lastActivity?: string;
	}>;
	activeTasks: unknown[];
	todayStats: {
		tasks: number;
		prs: number;
		failed: number;
		estimatedCost: number;
	};
}

function formatUptime(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

function readState(): DaemonState | null {
	const path = stateFilePath();
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as DaemonState;
	} catch {
		return null;
	}
}

async function fetchRemoteStatus(remoteName: string): Promise<void> {
	const config = loadGlobalConfig();
	const remote = config.remotes?.[remoteName];
	if (!remote) {
		console.error(`Remote "${remoteName}" not found in config.`);
		process.exitCode = 1;
		return;
	}

	const localPort = 17890;
	const tunnel = spawn("ssh", [
		"-L",
		`${localPort}:127.0.0.1:${remote.port}`,
		remote.host,
		"-N",
		"-o",
		"ConnectTimeout=5",
	]);

	// Wait for tunnel to establish
	await new Promise((r) => setTimeout(r, 2000));

	try {
		const res = await fetch(`http://localhost:${localPort}/status`);
		const state = (await res.json()) as DaemonState;
		renderStatus(state, remoteName);
	} catch {
		console.error(`Failed to connect to remote "${remoteName}".`);
		process.exitCode = 1;
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
