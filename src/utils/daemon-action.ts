import { daemonRequest } from "./daemon-client";
import { error } from "./ui";

export async function daemonAction(
  endpoint: string,
  taskId: string,
  successMessage: string,
): Promise<void> {
  const result = await daemonRequest(endpoint, { taskId });
  if (result.ok) {
    console.log(`${successMessage}: ${taskId}`);
  } else {
    error(result.body);
  }
}
