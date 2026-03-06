import type {
	TaskProvider,
	IncomingTask,
	TaskResult,
	ProjectContext,
} from "./types";
import { logger } from "../utils/logger";

// Slack Socket Mode provider
// Uses WebSocket connection (outbound only), no public URL needed

interface SlackMessage {
	type: string;
	text: string;
	channel: string;
	user: string;
	ts: string;
	thread_ts?: string;
}

export class SlackProvider implements TaskProvider {
	name = "slack";
	private botToken: string;
	private appToken: string;
	private ws: WebSocket | null = null;
	private pendingTasks: IncomingTask[] = [];
	private channelProjectMap: Record<string, string>;

	constructor(
		botToken: string,
		appToken: string,
		channelProjectMap: Record<string, string> = {}
	) {
		this.botToken = botToken;
		this.appToken = appToken;
		this.channelProjectMap = channelProjectMap;
	}

	async connect(): Promise<void> {
		// Get WebSocket URL via apps.connections.open
		const res = await fetch("https://slack.com/api/apps.connections.open", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.appToken}`,
				"Content-Type": "application/x-www-form-urlencoded",
			},
		});

		const data = (await res.json()) as { ok: boolean; url?: string };
		if (!data.ok || !data.url) {
			throw new Error("Failed to open Slack Socket Mode connection");
		}

		this.ws = new WebSocket(data.url);

		this.ws.onmessage = (event) => {
			try {
				const payload = JSON.parse(String(event.data));
				this.handleEvent(payload);
			} catch (err) {
				logger.error({ err }, "Failed to parse Slack event");
			}
		};

		this.ws.onerror = (err) => {
			logger.error({ err }, "Slack WebSocket error");
		};

		this.ws.onclose = () => {
			logger.info("Slack WebSocket closed, will reconnect on next poll");
			this.ws = null;
		};
	}

	private handleEvent(payload: {
		type: string;
		envelope_id?: string;
		payload?: { event?: SlackMessage };
	}): void {
		// Acknowledge the event
		if (payload.envelope_id && this.ws) {
			this.ws.send(JSON.stringify({ envelope_id: payload.envelope_id }));
		}

		if (payload.type !== "events_api" || !payload.payload?.event) return;

		const event = payload.payload.event;
		if (event.type !== "app_mention") return;

		// Parse the mention: @pergentic [in <project>] <task description>
		const text = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();

		let project: string | undefined;
		let description = text;

		const inMatch = text.match(/^in\s+(\S+)\s+(.+)/i);
		if (inMatch) {
			project = inMatch[1];
			description = inMatch[2];
		} else {
			// Try channel binding
			project = this.channelProjectMap[event.channel];
		}

		if (!description) return;

		this.pendingTasks.push({
			id: `slack-${event.ts}`,
			title: description.slice(0, 100),
			description,
			source: "slack",
			priority: 2,
			type: "new",
			metadata: {
				channel: event.channel,
				user: event.user,
				threadTs: event.thread_ts ?? event.ts,
				resolvedProject: project,
			},
			labels: [],
		});
	}

	async poll(_project: ProjectContext): Promise<IncomingTask[]> {
		if (!this.ws) {
			try {
				await this.connect();
			} catch (err) {
				logger.error({ err }, "Failed to connect to Slack");
				return [];
			}
		}

		const tasks = [...this.pendingTasks];
		this.pendingTasks = [];
		return tasks;
	}

	async onComplete(
		_project: ProjectContext,
		_taskId: string,
		result: TaskResult
	): Promise<void> {
		// Reply in thread
		// This would need the channel and thread_ts from metadata
		// For now, just log it
		logger.info(
			{ taskId: _taskId, status: result.status },
			"Slack task complete"
		);
	}

	disconnect(): void {
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
	}
}
