import chalk from "chalk";
import { daemonRequest } from "./daemon-client";

export async function daemonAction(
  endpoint: string,
  taskId: string,
  successMessage: string,
): Promise<void> {
  const result = await daemonRequest(endpoint, { taskId });
  if (result.ok) {
    console.log(`${successMessage}: ${taskId}`);
  } else {
    console.error(`${chalk.red("Error:")} ${result.body}`);
    process.exitCode = 1;
  }
}
