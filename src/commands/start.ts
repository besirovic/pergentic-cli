import { fork } from "node:child_process";
import { openSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isRunning, writePid } from "../utils/health";
import { daemonLogPath, globalConfigDir } from "../config/paths";
import { ensureGlobalConfigDir } from "../config/loader";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function forkDaemon(): { pid: number; logFile: string } | null {
	if (isRunning()) {
		return null;
	}

	ensureGlobalConfigDir();

	const daemonPath = resolve(__dirname, "..", "daemon.js");
	const logFile = daemonLogPath();

	const out = openSync(logFile, "a");
	const err = openSync(logFile, "a");

	const child = fork(daemonPath, [], {
		detached: true,
		stdio: ["ignore", out, err, "ipc"],
	});

	child.unref();

	if (child.pid) {
		writePid(child.pid);
		return { pid: child.pid, logFile };
	}

	return null;
}

export async function start(): Promise<void> {
	if (isRunning()) {
		console.log("Pergentic is already running.");
		console.log("Run `pergentic stop` to stop it first.");
		return;
	}

	const result = forkDaemon();
	if (result) {
		console.log(`🚀 Pergentic running in background (PID: ${result.pid})`);
		console.log(`   Logs: ${result.logFile}`);
		console.log(`   Stop: pergentic stop`);
	}

	process.exit(0);
}
