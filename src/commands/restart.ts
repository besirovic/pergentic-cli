import { stop } from "./stop";
import { start } from "./start";

export async function restart(): Promise<void> {
  await stop();
  // Brief delay to allow PID cleanup
  await new Promise((r) => setTimeout(r, 500));
  await start();
}
