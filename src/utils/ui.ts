import chalk from "chalk";

export function error(msg: string): void {
	console.error(`${chalk.red("Error:")} ${msg}`);
	process.exitCode = 1;
}

export function warn(msg: string): void {
	console.log(`${chalk.yellow("⚠")} ${msg}`);
}

export function success(msg: string): void {
	console.log(`${chalk.green("✓")} ${msg}`);
}

export function info(msg: string): void {
	console.log(chalk.dim(msg));
}
