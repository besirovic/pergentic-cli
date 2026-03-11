import { fork } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isRunning, writePid } from "../utils/health";
import { success } from "../utils/ui";
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

	try {
		const child = fork(daemonPath, [], {
			detached: true,
			stdio: ["ignore", out, err, "ipc"],
		});

		child.unref();
		if (child.connected) child.disconnect();

		if (child.pid) {
			writePid(child.pid);
			return { pid: child.pid, logFile };
		}

		return null;
	} finally {
		// Close parent's copies of the FDs; the child inherits its own copies.
		closeSync(out);
		closeSync(err);
	}
}

export async function start(): Promise<void> {
	if (isRunning()) {
		console.log("Pergentic is already running.");
		console.log("Run `pergentic stop` to stop it first.");
		return;
	}

	const result = forkDaemon();
	if (result) {
		success(`Pergentic running in background (PID: ${result.pid})`);
		console.log(`   Logs: ${result.logFile}`);
		console.log(`   Stop: pergentic stop`);
	}
}
