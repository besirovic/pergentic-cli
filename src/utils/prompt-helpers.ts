import chalk from "chalk";

export const promptTheme = {
	prefix: { idle: chalk.cyan("?"), done: chalk.green("✓") },
	icon: { cursor: chalk.cyan("›") },
	style: {
		answer: (text: string) => chalk.cyan(text),
		highlight: (text: string) => chalk.cyan.bold(text),
		message: (text: string) => chalk.bold(text),
	},
};

export function isExitPromptError(err: unknown): boolean {
	return (
		err instanceof Error &&
		(err.name === "ExitPromptError" ||
			err.constructor.name === "ExitPromptError")
	);
}
