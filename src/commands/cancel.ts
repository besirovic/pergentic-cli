import { daemonAction } from "../utils/daemon-action";

export async function cancel(taskId: string): Promise<void> {
	await daemonAction("cancel", taskId, "Cancelled task");
}
