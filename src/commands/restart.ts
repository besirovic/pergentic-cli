import { stop } from "./stop";
import { forkDaemon } from "./start";
import { error, warn, success } from "../utils/ui";

const PID_CLEANUP_DELAY_MS = 500;

export async function restart(): Promise<void> {
  try {
    await stop();
  } catch (err) {
    warn(`stop encountered an issue: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Brief delay to allow PID cleanup
  await new Promise((r) => setTimeout(r, PID_CLEANUP_DELAY_MS));

  const result = forkDaemon();
  if (result) {
    success(`Pergentic running in background (PID: ${result.pid})`);
    console.log(`   Logs: ${result.logFile}`);
    console.log(`   Stop: pergentic stop`);
  } else {
    error("Failed to start daemon. It may already be running.");
  }
}
