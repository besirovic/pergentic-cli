import { isRunning } from "../utils/health";
import { loadGlobalConfig } from "../config/loader";

export async function retry(taskId: string): Promise<void> {
	if (!isRunning()) {
		console.error("Pergentic is not running. Start it with `pergentic start`.");
		process.exitCode = 1;
		return;
	}

	const config = loadGlobalConfig();
	const port = config.statusPort;

	try {
		const res = await fetch(`http://127.0.0.1:${port}/retry`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ taskId }),
		});

		if (res.ok) {
			console.log(`Retrying task: ${taskId}`);
		} else {
			const body = await res.text();
			console.error(`Failed to retry: ${body}`);
			process.exitCode = 1;
		}
	} catch {
		console.error("Failed to connect to daemon.");
		process.exitCode = 1;
	}
}
