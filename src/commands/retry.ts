import { daemonAction } from "../utils/daemon-action";

export async function retry(taskId: string): Promise<void> {
	await daemonAction("retry", taskId, "Retrying task");
}
