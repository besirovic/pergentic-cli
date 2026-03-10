import chalk from "chalk";
import { getTaskHistory, type TaskCostEntry } from "../core/cost";
import { formatDuration } from "../utils/format";

function statusIcon(status?: string): string {
	return status === "failed" ? "✗" : "✓";
}

function listView(entries: TaskCostEntry[], limit: number, project?: string): void {
	let filtered = entries;
	if (project) {
		filtered = filtered.filter((e) => e.project === project);
	}

	const recent = filtered.slice(-limit).reverse();

	if (recent.length === 0) {
		console.log("No task history found.");
		return;
	}

	for (const entry of recent) {
		const icon = statusIcon(entry.status);
		const dur = formatDuration(entry.duration);
		const cost = entry.cost > 0 ? ` $${entry.cost.toFixed(2)}` : "";
		const detail = entry.prUrl
			? entry.prUrl
			: entry.error
				? entry.error.slice(0, 80)
				: "";
		const proj = entry.project ? `[${entry.project}]` : "";

		console.log(
			`${icon} ${entry.taskId} ${proj} ${entry.title ?? ""} (${dur}${cost})${detail ? ` - ${detail}` : ""}`
		);
	}
}

async function detailView(taskId: string): Promise<void> {
	const entries = (await getTaskHistory()).filter((e) => e.taskId === taskId);

	if (entries.length === 0) {
		console.error(`${chalk.red("Error:")} No history found for task "${taskId}".`);
		process.exitCode = 1;
		return;
	}

	const entry = entries[entries.length - 1];
	console.log(`Task:      ${entry.taskId}`);
	if (entry.title) console.log(`Title:     ${entry.title}`);
	if (entry.project) console.log(`Project:   ${entry.project}`);
	console.log(`Status:    ${entry.status ?? "unknown"}`);
	console.log(`Duration:  ${formatDuration(entry.duration)}`);
	if (entry.cost > 0) console.log(`Cost:      $${entry.cost.toFixed(2)}`);
	console.log(`Timestamp: ${entry.timestamp}`);
	if (entry.prUrl) console.log(`PR:        ${entry.prUrl}`);
	if (entry.error) {
		console.log(`Error:     ${entry.error}`);
		console.log(`\nRetry with: pergentic retry ${entry.taskId}`);
	}
}

export async function history(opts: {
	taskId?: string;
	project?: string;
	limit: string;
}): Promise<void> {
	if (opts.taskId) {
		await detailView(opts.taskId);
		return;
	}

	const entries = await getTaskHistory();
	listView(entries, parseInt(opts.limit, 10) || 20, opts.project);
}
