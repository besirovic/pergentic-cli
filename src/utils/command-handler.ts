import { isExitPromptError } from "./prompt-helpers";
import { error } from "./ui";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Commander.js action callbacks have heterogeneous signatures (string, Options, Command); unknown[] is incompatible
export function handleCommand<T extends (...args: any[]) => Promise<void>>(fn: T): T {
	return (async (...args: Parameters<T>) => {
		try {
			await fn(...args);
		} catch (err) {
			if (isExitPromptError(err)) {
				process.exit(0);
			}
			const msg = err instanceof Error ? err.message : String(err);
			error(msg);
			process.exitCode = 1;
		}
	}) as T;
}
