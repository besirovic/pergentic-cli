import { stop } from "./stop";
import { forkDaemon } from "./start";

export async function restart(): Promise<void> {
  try {
    await stop();
  } catch (err) {
    console.warn(`Warning: stop encountered an issue: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Brief delay to allow PID cleanup
  await new Promise((r) => setTimeout(r, 500));

  const result = forkDaemon();
  if (result) {
    console.log(`🚀 Pergentic running in background (PID: ${result.pid})`);
    console.log(`   Logs: ${result.logFile}`);
    console.log(`   Stop: pergentic stop`);
  } else {
    console.error("Failed to start daemon. It may already be running.");
    process.exitCode = 1;
  }
}
