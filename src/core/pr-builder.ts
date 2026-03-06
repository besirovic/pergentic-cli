import type { Task } from "./queue";
import type { ProjectConfig } from "../config/schema";

export interface PRDetails {
  title: string;
  body: string;
  commitMessage: string;
}

export function buildPRDetails(task: Task, projectConfig: ProjectConfig): PRDetails {
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

  const body = isScheduled
    ? `Automated scheduled task: **${payload.title}**\n\nSchedule: \`${"scheduleId" in payload ? payload.scheduleId : ""}\``
    : (prConfig?.bodyTemplate ?? "Resolves {taskId}")
        .replace("{taskTitle}", payload.title)
        .replace("{taskId}", payload.taskId);

  return { title, body, commitMessage };
}
