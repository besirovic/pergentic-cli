import { isRunning } from "../utils/health";
import { loadGlobalConfig } from "../config/loader";

export async function cancel(taskId: string): Promise<void> {
	if (!isRunning()) {
		console.error("Pergentic is not running. Start it with `pergentic start`.");
		process.exitCode = 1;
		return;
	}

	const config = loadGlobalConfig();
	const port = config.statusPort;

	try {
		const res = await fetch(`http://127.0.0.1:${port}/cancel`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ taskId }),
		});

		if (res.ok) {
			console.log(`Cancelled task: ${taskId}`);
		} else {
			const body = await res.text();
			console.error(`Failed to cancel: ${body}`);
			process.exitCode = 1;
		}
	} catch {
		console.error("Failed to connect to daemon.");
		process.exitCode = 1;
	}
}
