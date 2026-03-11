import { execFile } from "node:child_process";
import { platform } from "node:os";
import type { GlobalConfig, ProjectConfig, Notifications } from "../config/schema";
import { logger } from "../utils/logger";
import { formatDuration } from "../utils/format";
import { fetchWithRetry } from "../utils/http";

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
	retriesAttempted?: number;
}

type NotificationDialect = "slack" | "discord";

const dialectSyntax: Record<NotificationDialect, { bold: (s: string) => string; link: (url: string, text: string) => string }> = {
	slack: {
		bold: (s) => `*${s}*`,
		link: (url, text) => `<${url}|${text}>`,
	},
	discord: {
		bold: (s) => `**${s}**`,
		link: (url, text) => `[${text}](${url})`,
	},
};

function formatNotificationMessage(event: TaskEvent, dialect: NotificationDialect): string {
	const { bold, link } = dialectSyntax[dialect];

	switch (event.type) {
		case "taskCompleted":
		case "prCreated":
			return [
				`${dialect === "slack" ? "✅ " : ""}${bold(`${event.taskId}:`)} ${event.title}`,
				`${bold("Project:")} ${event.project}`,
				event.prUrl
					? `${bold("PR:")} ${link(event.prUrl, "View Pull Request")}`
					: "",
				event.duration
					? `${bold("Duration:")} ${formatDuration(event.duration)}`
					: "",
				event.estimatedCost
					? `${bold("Cost:")} $${event.estimatedCost.toFixed(2)}`
					: "",
			]
				.filter(Boolean)
				.join("\n");

		case "taskFailed":
			return [
				`${dialect === "slack" ? "❌ " : ""}${bold(`${event.taskId}:`)} ${event.title}`,
				`${bold("Project:")} ${event.project}`,
				event.retriesAttempted
					? `${bold("Retries:")} ${event.retriesAttempted} automatic retries attempted`
					: "",
				event.error
					? `${bold("Error:")}\n\`\`\`${event.error}\`\`\``
					: `${bold("Error:")} Unknown`,
				`Run \`pergentic retry ${event.taskId}\` to retry`,
			].filter(Boolean).join("\n");
	}
}

function formatDesktopMessage(event: TaskEvent): { title: string; body: string } {
	switch (event.type) {
		case "taskCompleted":
		case "prCreated": {
			const parts = [event.taskId, event.title];
			if (event.prUrl) parts.push(event.prUrl);
			if (event.duration) parts.push(formatDuration(event.duration));
			return { title: "Task Completed", body: parts.join(" - ") };
		}
		case "taskFailed": {
			const retryInfo = event.retriesAttempted
				? ` (${event.retriesAttempted} retries attempted)`
				: "";
			return {
				title: "Task Failed",
				body: `${event.taskId}: ${event.title}${retryInfo}${event.error ? ` - ${event.error.slice(0, 200)}` : ""}`,
			};
		}
	}
}

function escapeAppleScript(str: string): string {
	return str
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, " ")
		.replace(/\r/g, " ")
		.replace(/\t/g, " ");
}

function sendDesktopNotification(event: TaskEvent): Promise<void> {
	const { title, body } = formatDesktopMessage(event);
	const os = platform();

	return new Promise((resolve) => {
		if (os === "darwin") {
			const script = `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}"`;
			execFile("osascript", ["-e", script], (err) => {
				if (err) logger.debug({ err }, "Desktop notification failed");
				resolve();
			});
		} else if (os === "linux") {
			execFile("notify-send", [title, body], (err) => {
				if (err) logger.debug({ err }, "Desktop notification failed");
				resolve();
			});
		} else {
			logger.debug({ os }, "Desktop notifications not supported on this platform");
			resolve();
		}
	});
}

async function sendSlackBotMessage(
	channel: string,
	text: string,
	botToken: string,
): Promise<void> {
	const res = await fetchWithRetry("https://slack.com/api/chat.postMessage", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${botToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ channel, text }),
	});

	const data = (await res.json()) as { ok: boolean; error?: string };
	if (!data.ok) {
		throw new Error(`Slack API error: ${data.error}`);
	}
}

function resolveNotifications(
	globalConfig: GlobalConfig,
	projectConfig?: ProjectConfig,
): Notifications | undefined {
	const project = projectConfig?.notifications;
	const global = globalConfig.notifications;
	if (!project && !global) return undefined;
	return {
		slack: project?.slack ?? global?.slack,
		discord: project?.discord ?? global?.discord,
		desktop: project?.desktop ?? global?.desktop,
	};
}

export interface NotifyResult {
	succeeded: number;
	failed: number;
}

export async function notify(
	event: TaskEvent,
	config: GlobalConfig,
	projectConfig?: ProjectConfig,
): Promise<NotifyResult> {
	const notifications = resolveNotifications(config, projectConfig);
	if (!notifications) return { succeeded: 0, failed: 0 };

	const entries: { provider: string; promise: Promise<void> }[] = [];

	if (notifications.slack?.on[event.type]) {
		const channelId = projectConfig?.slack?.channels?.[event.type];
		const botToken = projectConfig?.slackBotToken;

		if (channelId && botToken) {
			// Route to specific channel via Bot API
			entries.push({
				provider: "slack-bot",
				promise: sendSlackBotMessage(channelId, formatNotificationMessage(event, "slack"), botToken),
			});
		} else {
			// Fall back to global webhook
			entries.push({
				provider: "slack-webhook",
				promise: fetchWithRetry(notifications.slack.webhook, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ text: formatNotificationMessage(event, "slack") }),
				}).then(() => undefined),
			});
		}
	}

	if (notifications.discord?.on[event.type]) {
		entries.push({
			provider: "discord",
			promise: fetchWithRetry(notifications.discord.webhook, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ content: formatNotificationMessage(event, "discord") }),
			}).then(() => undefined),
		});
	}

	if (notifications.desktop?.on[event.type]) {
		entries.push({ provider: "desktop", promise: sendDesktopNotification(event) });
	}

	if (entries.length === 0) return { succeeded: 0, failed: 0 };

	const results = await Promise.allSettled(entries.map((e) => e.promise));

	let succeeded = 0;
	let failed = 0;
	for (let i = 0; i < results.length; i++) {
		const result = results[i];
		const provider = entries[i].provider;
		if (result.status === "fulfilled") {
			logger.debug({ event: event.type, provider }, "Notification sent");
			succeeded++;
		} else {
			logger.warn({ err: result.reason, provider, event: event.type }, "Notification failed");
			failed++;
		}
	}

	logger.debug(
		{ succeeded, total: entries.length, event: event.type },
		`Notifications: ${succeeded}/${entries.length} succeeded`,
	);

	return { succeeded, failed };
}
