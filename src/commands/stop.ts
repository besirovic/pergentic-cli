import { readPid, removePid, isRunning } from "../utils/health";

export async function stop(): Promise<void> {
	if (!isRunning()) {
		console.log("Pergentic is not running.");
		return;
	}

	const pid = readPid();
	if (pid === null) {
		console.log("Pergentic is not running.");
		return;
	}

	try {
		process.kill(pid, "SIGTERM");
		removePid();
		console.log("Pergentic stopped.");
	} catch {
		removePid();
		console.log("Pergentic was not running (stale PID file cleaned up).");
	}
}
