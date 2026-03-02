import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
	try {
		const pkg = JSON.parse(
			readFileSync(join(__dirname, "..", "package.json"), "utf-8")
		);
		return pkg.version;
	} catch {
		return "0.0.0";
	}
}

export function createProgram(): Command {
	const program = new Command();

	program
		.name("pergentic")
		.description(
			"Turn project management tickets into pull requests autonomously"
		)
		.version(getVersion())
		.option("--verbose", "Enable verbose logging");

	program
		.command("init")
		.description("Interactive project setup wizard")
		.argument("[path]", "Project directory path", process.cwd())
		.action(async (projectPath: string) => {
			const { init } = await import("./commands/init.js");
			await init(projectPath);
		});

	program
		.command("add")
		.description("Register a project directory")
		.argument("[path]", "Project directory path", process.cwd())
		.action(async (projectPath: string) => {
			const { add } = await import("./commands/add.js");
			await add(projectPath);
		});

	program
		.command("remove")
		.description("Unregister a project")
		.argument("[path]", "Project directory path", process.cwd())
		.action(async (projectPath: string) => {
			const { remove } = await import("./commands/remove.js");
			await remove(projectPath);
		});

	program
		.command("list")
		.description("Show all registered projects")
		.action(async () => {
			const { list } = await import("./commands/list.js");
			await list();
		});

	program
		.command("start")
		.description("Start daemon in background")
		.action(async () => {
			const { start } = await import("./commands/start.js");
			await start();
		});

	program
		.command("stop")
		.description("Stop daemon gracefully")
		.action(async () => {
			const { stop } = await import("./commands/stop.js");
			await stop();
		});

	program
		.command("restart")
		.description("Stop + start daemon")
		.action(async () => {
			const { restart } = await import("./commands/restart.js");
			await restart();
		});

	program
		.command("status")
		.description("One-line status check")
		.option("--remote <name>", "Check remote instance via SSH tunnel")
		.action(async (opts: { remote?: string }) => {
			const { status } = await import("./commands/status.js");
			await status(opts);
		});

	program
		.command("dashboard")
		.description("Full TUI monitoring dashboard")
		.action(async () => {
			const { dashboard } = await import("./commands/dashboard.js");
			await dashboard();
		});

	program
		.command("logs")
		.description("Tail daemon logs")
		.option("--project <name>", "Filter by project")
		.option("-n, --lines <count>", "Number of lines", "50")
		.option("-f, --follow", "Follow log output")
		.action(
			async (opts: { project?: string; lines: string; follow?: boolean }) => {
				const { logs } = await import("./commands/logs.js");
				await logs(opts);
			}
		);

	program
		.command("retry")
		.description("Retry a failed task")
		.argument("<taskId>", "Task ID to retry")
		.action(async (taskId: string) => {
			const { retry } = await import("./commands/retry.js");
			await retry(taskId);
		});

	program
		.command("cancel")
		.description("Cancel a running task")
		.argument("<taskId>", "Task ID to cancel")
		.action(async (taskId: string) => {
			const { cancel } = await import("./commands/cancel.js");
			await cancel(taskId);
		});

	program
		.command("service")
		.description("Service management")
		.command("install")
		.description("Generate systemd/launchd service config")
		.action(async () => {
			const { serviceInstall } = await import("./commands/service.js");
			await serviceInstall();
		});

	return program;
}

export async function run(): Promise<void> {
	const program = createProgram();
	await program.parseAsync(process.argv);
}
