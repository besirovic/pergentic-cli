import { basename } from "node:path";
import { Cron } from "croner";
import { TaskQueue, type Task } from "./queue";
import type { TaskRunner } from "./runner";
import { loadSchedulesConfig, updateLastRun, readPromptFile, PROMPT_TEMPLATE } from "../config/schedules";
import { loadProjectsRegistry, loadProjectConfig } from "../config/loader";
import type { ScheduleEntry } from "../config/schema";
import { logger } from "../utils/logger";

export class Scheduler {
	private queue: TaskQueue;
	private runner: TaskRunner;
	private active = new Set<string>();
	private checking = false;

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

		if (schedule.type === "prompt") {
			if (!schedule.prompt) {
				logger.warn({ scheduleId: schedule.id }, "Schedule has no prompt path configured");
				this.active.delete(schedule.id);
				return;
			}

			const content = readPromptFile(projectPath, schedule.prompt);
			if (!content || content.trim() === "" || content.trim() === PROMPT_TEMPLATE(schedule.name).trim()) {
				logger.warn({ scheduleId: schedule.id, promptPath: schedule.prompt }, "Prompt file is empty or still contains template placeholder");
				this.active.delete(schedule.id);
				return;
			}

			const task: Task = {
				id: taskId,
				project: projectName,
				priority: 4,
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
					branch: schedule.branch,
					targetAgents: schedule.agent ? [schedule.agent] : undefined,
				},
			};

			if (this.queue.add(task)) {
				updateLastRun(projectPath, schedule.id, timestamp);
				logger.info({ scheduleId: schedule.id, taskId, project: projectName }, "Queued scheduled prompt task");
			} else {
				this.active.delete(schedule.id);
			}
		} else if (schedule.type === "command") {
			if (!schedule.command) {
				logger.warn({ scheduleId: schedule.id }, "Schedule has no command configured");
				this.active.delete(schedule.id);
				return;
			}

			const task: Task = {
				id: taskId,
				project: projectName,
				priority: 4,
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
					branch: schedule.branch,
				},
			};

			if (this.queue.add(task)) {
				updateLastRun(projectPath, schedule.id, timestamp);
				logger.info({ scheduleId: schedule.id, taskId, project: projectName }, "Queued scheduled command task");
			} else {
				this.active.delete(schedule.id);
			}
		}
	}

	clearActive(scheduleId: string): void {
		this.active.delete(scheduleId);
	}
}
