import { isExitPromptError } from "./prompt-helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleCommand<T extends (...args: any[]) => Promise<void>>(fn: T): T {
	return (async (...args: Parameters<T>) => {
		try {
			await fn(...args);
		} catch (err) {
			if (isExitPromptError(err)) {
				process.exit(0);
			}
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`Error: ${msg}`);
			process.exitCode = 1;
		}
	}) as T;
}
