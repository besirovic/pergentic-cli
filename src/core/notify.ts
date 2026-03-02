import type { GlobalConfig } from "../config/schema";
import { logger } from "../utils/logger";

export type EventType = "taskCompleted" | "taskFailed" | "prCreated";

export interface TaskEvent {
	type: EventType;
	taskId: string;
	title: string;
	project: string;
	prUrl?: string;
	duration?: number;
	estimatedCost?: number;
	error?: string;
}

function formatDuration(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatSlackMessage(event: TaskEvent): string {
	switch (event.type) {
		case "taskCompleted":
		case "prCreated":
			return [
				`✅ ${event.taskId}: ${event.title}`,
				event.prUrl ? `   PR created: ${event.prUrl}` : "",
				event.duration ? `   Duration: ${formatDuration(event.duration)}` : "",
				event.estimatedCost
					? `   Cost: $${event.estimatedCost.toFixed(2)}`
					: "",
			]
				.filter(Boolean)
				.join("\n");

		case "taskFailed":
			return [
				`❌ ${event.taskId}: ${event.title}`,
				event.error ? `   Failed: ${event.error}` : "   Failed",
				`   Run \`pergentic retry ${event.taskId}\` to retry`,
			].join("\n");
	}
}

function formatDiscordMessage(event: TaskEvent): string {
	// Discord uses the same format as Slack for simple text
	return formatSlackMessage(event);
}

export async function notify(
	event: TaskEvent,
	config: GlobalConfig
): Promise<void> {
	const notifications = config.notifications;
	if (!notifications) return;

	const promises: Promise<void>[] = [];

	if (notifications.slack?.on[event.type]) {
		promises.push(
			fetch(notifications.slack.webhook, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text: formatSlackMessage(event) }),
			})
				.then(() => {
					logger.debug({ event: event.type }, "Slack notification sent");
				})
				.catch((err) => {
					logger.error({ err }, "Failed to send Slack notification");
				})
		);
	}

	if (notifications.discord?.on[event.type]) {
		promises.push(
			fetch(notifications.discord.webhook, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ content: formatDiscordMessage(event) }),
			})
				.then(() => {
					logger.debug({ event: event.type }, "Discord notification sent");
				})
				.catch((err) => {
					logger.error({ err }, "Failed to send Discord notification");
				})
		);
	}

	await Promise.allSettled(promises);
}
