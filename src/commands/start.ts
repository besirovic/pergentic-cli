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

	const closeFds = () => {
		// Close parent's copies of the FDs; the child inherits its own copies.
		// Ignore EBADF in case the FD was already closed during a partial fork failure.
		try {
			closeSync(out);
		} catch (e: unknown) {
			if ((e as NodeJS.ErrnoException).code !== "EBADF") throw e;
		}
		try {
			closeSync(err);
		} catch (e: unknown) {
			if ((e as NodeJS.ErrnoException).code !== "EBADF") throw e;
		}
	};

	try {
		const child = fork(daemonPath, [], {
			detached: true,
			stdio: ["ignore", out, err, "ipc"],
		});

		child.unref();
		if (child.connected) child.disconnect();

		if (child.pid) {
			// Child has inherited its own copies of the FDs; close the parent's copies.
			closeFds();
			writePid(child.pid);
			return { pid: child.pid, logFile };
		}

		closeFds();
		return null;
	} catch (e) {
		// fork() threw — close the FDs the parent opened before re-throwing.
		closeFds();
		throw e;
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
