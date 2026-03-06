import { daemonRequest } from "../utils/daemon-client";

export async function retry(taskId: string): Promise<void> {
	const result = await daemonRequest("retry", { taskId });
	if (result.ok) {
		console.log(`Retrying task: ${taskId}`);
	} else {
		console.error(result.body);
		process.exitCode = 1;
	}
}
