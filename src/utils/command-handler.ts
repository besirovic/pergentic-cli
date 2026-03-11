import { isExitPromptError } from "./prompt-helpers";
import { error } from "./ui";

function isModuleNotFoundError(err: unknown): boolean {
	return (
		err instanceof Error &&
		((err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND" ||
			(err as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND")
	);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Commander.js action callbacks have heterogeneous signatures (string, Options, Command); unknown[] is incompatible
export function handleCommand<T extends (...args: any[]) => Promise<void>>(fn: T): T {
	return (async (...args: Parameters<T>) => {
		try {
			await fn(...args);
		} catch (err) {
			if (isExitPromptError(err)) {
				process.exit(0);
			}
			if (isModuleNotFoundError(err)) {
				error("Command module not found. Try rebuilding: yarn build");
				process.exitCode = 1;
				return;
			}
			const msg = err instanceof Error ? err.message : String(err);
			error(msg);
			process.exitCode = 1;
		}
	}) as T;
}
