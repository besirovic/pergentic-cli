import { stop } from "./stop";
import { forkDaemon } from "./start";
import { error, warn, success } from "../utils/ui";
import { TIMEOUTS } from "../config/constants";

export async function restart(): Promise<void> {
  try {
    await stop();
  } catch (err) {
    warn(`stop encountered an issue: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Brief delay to allow PID cleanup
  await new Promise((r) => setTimeout(r, TIMEOUTS.PID_CLEANUP_MS));

  const result = forkDaemon();
  if (result) {
    success(`Pergentic running in background (PID: ${result.pid})`);
    console.log(`   Logs: ${result.logFile}`);
    console.log(`   Stop: pergentic stop`);
  } else {
    error("Failed to start daemon. It may already be running.");
  }
}
