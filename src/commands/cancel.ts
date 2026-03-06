import { daemonRequest } from "../utils/daemon-client";

export async function cancel(taskId: string): Promise<void> {
	const result = await daemonRequest("cancel", { taskId });
	if (result.ok) {
		console.log(`Cancelled task: ${taskId}`);
	} else {
		console.error(result.body);
		process.exitCode = 1;
	}
}
