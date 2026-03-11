import type { Task } from "./queue";
import { isScheduledTask } from "./queue";
import type { ProjectConfig } from "../config/schema";

export interface PRDetails {
	title: string;
	body: string;
	commitMessage: string;
}

/**
 * Build PR details (title, body, commit message) for a task.
 * This is a pure function — all inputs are passed explicitly.
 *
 * @param task - The task being executed
 * @param projectConfig - Project configuration
 * @param agentBody - Optional agent-generated PR body (read by caller from worktree)
 */
export function buildPRDetails(
	task: Task,
	projectConfig: ProjectConfig,
	agentBody?: string | null,
): PRDetails {
	const { payload } = task;
	const isScheduled = task.type === "scheduled";

	const commitMessage = isScheduled
		? `chore(schedule): ${payload.title} [${payload.taskId}]`
		: `feat: ${payload.title} [${payload.taskId}]`;

	const prConfig = projectConfig.pr;
	const isLabelTriggered = payload.targetAgents && payload.targetAgents.length > 0;
	const prAgentName = payload.targetAgents?.[0] ?? projectConfig.agent;

	const modelSuffix = payload.targetModelLabel
		? ` [${prAgentName}/${payload.targetModelLabel}]`
		: (isLabelTriggered ? ` [${prAgentName}]` : "");

	const title = isScheduled
		? `chore(schedule): ${payload.title}`
		: (prConfig?.titleFormat ?? "feat: {taskTitle} [{taskId}]")
				.replace("{taskTitle}", payload.title)
				.replace("{taskId}", payload.taskId)
				+ modelSuffix;

	// Use agent-generated PR body if provided, otherwise fall back to configured template
	const scheduleId = isScheduledTask(task) ? task.payload.scheduleId ?? "" : "";
	const body = agentBody
		?? (isScheduled
			? `Automated scheduled task: **${payload.title}**\n\nSchedule: \`${scheduleId}\``
			: (prConfig?.bodyTemplate ?? "Resolves {taskId}")
					.replace("{taskTitle}", payload.title)
					.replace("{taskId}", payload.taskId));

	return { title, body, commitMessage };
}
