import { basename } from "node:path";
import { Cron } from "croner";
import { TaskQueue, TaskPriority, type Task } from "./queue";
import type { TaskRunner } from "./runner";
import { loadSchedulesConfig, updateLastRun, readPromptFile, PROMPT_TEMPLATE } from "../config/schedules";
import { loadProjectsRegistry, loadProjectConfig } from "../config/loader";
import type { ScheduleEntry } from "../config/schema";
import { logger } from "../utils/logger";

const MAX_LAST_DISPATCHED = 1000;

export class Scheduler {
	private queue: TaskQueue;
	private runner: TaskRunner;
	private active = new Set<string>();
	private checking = false;
	private lastDispatched = new Map<string, number>();

	constructor(queue: TaskQueue, runner: TaskRunner) {
		this.queue = queue;
		this.runner = runner;
	}

	async checkDue(): Promise<void> {
		if (this.checking) return;
		this.checking = true;

		try {
			const registry = loadProjectsRegistry();
			const now = new Date();

			for (const entry of registry.projects) {
				const projectName = basename(entry.path);

				let schedulesConfig;
				try {
					schedulesConfig = loadSchedulesConfig(entry.path);
				} catch (err) {
					logger.warn({ project: projectName, err }, "Failed to load schedules config");
					continue;
				}

				for (const schedule of schedulesConfig.schedules) {
					if (!schedule.enabled) continue;
					if (this.active.has(schedule.id)) continue;

					if (this.isDue(schedule, now)) {
						if (this.queue.hasScheduleId(schedule.id)) {
							logger.debug({ scheduleId: schedule.id }, "Schedule already in queue, skipping");
							continue;
						}
						this.active.add(schedule.id);
						await this.dispatchSchedule(entry.path, projectName, schedule, now);
					}
				}
			}
		} finally {
			this.checking = false;
		}
	}

	private isDue(schedule: ScheduleEntry, now: Date): boolean {
		try {
			const cron = new Cron(schedule.cron);

			if (!schedule.lastRun) {
				// Never run — due if there's a valid next run from epoch
				const next = cron.nextRun(new Date(0));
				return next !== null && next <= now;
			}

			const lastRun = new Date(schedule.lastRun);
			// Find the next scheduled time after lastRun; if it's in the past → due
			const next = cron.nextRun(lastRun);
			return next !== null && next <= now;
		} catch (err) {
			logger.error({ scheduleId: schedule.id, cron: schedule.cron, err }, "Invalid cron expression");
			return false;
		}
	}

	private async dispatchSchedule(
		projectPath: string,
		projectName: string,
		schedule: ScheduleEntry,
		now: Date,
	): Promise<void> {
		const timestamp = now.toISOString();
		const taskId = `schedule-${schedule.id}-${Date.now()}`;
		let dispatched = false;

		try {
			let task: Task | undefined;

			if (schedule.type === "prompt") {
				if (!schedule.prompt) {
					logger.warn({ scheduleId: schedule.id }, "Schedule has no prompt path configured");
					return;
				}

				const content = readPromptFile(projectPath, schedule.prompt);
				if (!content || content.trim() === "" || content.trim() === PROMPT_TEMPLATE(schedule.name).trim()) {
					logger.warn({ scheduleId: schedule.id, promptPath: schedule.prompt }, "Prompt file is empty or still contains template placeholder");
					return;
				}

				task = {
					id: taskId,
					project: projectName,
					priority: TaskPriority.SCHEDULED,
					type: "scheduled",
					createdAt: Date.now(),
					payload: {
						taskId,
						title: schedule.name,
						description: content,
						source: "schedule",
						scheduleId: schedule.id,
						schedulePrBehavior: schedule.prBehavior,
						schedulePrBranch: schedule.prBranch,
						scheduleTimeout: schedule.scheduleTimeout,
						branch: schedule.branch,
						targetAgents: schedule.agent ? [schedule.agent] : undefined,
					},
				};
			} else if (schedule.type === "command") {
				if (!schedule.command) {
					logger.warn({ scheduleId: schedule.id }, "Schedule has no command configured");
					return;
				}

				task = {
					id: taskId,
					project: projectName,
					priority: TaskPriority.SCHEDULED,
					type: "scheduled",
					createdAt: Date.now(),
					payload: {
						taskId,
						title: schedule.name,
						description: `Scheduled command: ${schedule.command}`,
						source: "schedule",
						scheduleId: schedule.id,
						scheduledCommand: schedule.command,
						schedulePrBehavior: schedule.prBehavior,
						schedulePrBranch: schedule.prBranch,
						scheduleTimeout: schedule.scheduleTimeout,
						branch: schedule.branch,
					},
				};
			}

			if (task && this.queue.add(task)) {
				updateLastRun(projectPath, schedule.id, timestamp);
				dispatched = true;
				this.lastDispatched.set(schedule.id, now.getTime());
				this.pruneLastDispatched();
				logger.info({ scheduleId: schedule.id, taskId, project: projectName }, "Queued scheduled task");
			}
		} catch (err) {
			logger.error({ scheduleId: schedule.id, err }, "Failed to dispatch schedule, will retry next cycle");
			this.queue.remove(taskId);
		} finally {
			if (!dispatched) {
				this.active.delete(schedule.id);
			}
		}
	}

	clearActive(scheduleId: string): void {
		this.active.delete(scheduleId);
	}

	private pruneLastDispatched(): void {
		if (this.lastDispatched.size <= MAX_LAST_DISPATCHED) return;
		const sorted = Array.from(this.lastDispatched.entries()).sort((a, b) => a[1] - b[1]);
		const toRemove = sorted.slice(0, sorted.length - MAX_LAST_DISPATCHED);
		for (const [key] of toRemove) {
			this.lastDispatched.delete(key);
		}
	}
}
