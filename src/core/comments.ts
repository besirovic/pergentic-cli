import { getChangeSummary } from "./git";
import { replyToPRComment } from "./git";
import { logger } from "../utils/logger";
import type { ProjectConfig } from "../config/schema";
import type { Task } from "./queue";

export interface CommentContext {
  worktreePath: string;
  repo: string;
  prUrl: string;
  prNumber: number;
  taskTitle: string;
  taskId: string;
  projectConfig: ProjectConfig;
  task: Task;
}

function buildCommentBody(ctx: {
  taskId: string;
  taskTitle: string;
  commitMessage: string;
  stats: string;
  prUrl: string;
}): string {
  return [
    "## Changes from pergentic",
    "",
    `**Task:** ${ctx.taskId}: ${ctx.taskTitle}`,
    "",
    `**Commit:** ${ctx.commitMessage}`,
    "",
    `**Files changed:** ${ctx.stats}`,
    "",
    `**Pull Request:** ${ctx.prUrl}`,
    "",
    "---",
    "*Automated by pergentic*",
  ].join("\n");
}

async function postLinearComment(
  linearId: string,
  body: string,
  linearApiKey: string,
): Promise<void> {
  const mutation = `
    mutation($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) {
        success
      }
    }
  `;

  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: linearApiKey,
    },
    body: JSON.stringify({
      query: mutation,
      variables: { issueId: linearId, body },
    }),
  });

  if (!res.ok) {
    throw new Error(`Linear comment failed (${res.status})`);
  }
}

async function postJiraComment(
  jiraIssueKey: string,
  body: string,
  jiraDomain: string,
  jiraEmail: string,
  jiraApiToken: string,
): Promise<void> {
  const auth = Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString("base64");

  const res = await fetch(
    `https://${jiraDomain}/rest/api/3/issue/${jiraIssueKey}/comment`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        body: {
          version: 1,
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: body }],
            },
          ],
        },
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`Jira comment failed (${res.status})`);
  }
}

export async function postTaskComments(ctx: CommentContext): Promise<void> {
  if (ctx.task.type !== "new") return;

  let stats: string;
  let commitMessage: string;
  try {
    const summary = await getChangeSummary(ctx.worktreePath);
    stats = summary.stats;
    commitMessage = summary.commitMessage;
  } catch (err) {
    logger.error({ err }, "Failed to get change summary for comments");
    return;
  }

  const body = buildCommentBody({
    taskId: ctx.taskId,
    taskTitle: ctx.taskTitle,
    commitMessage,
    stats,
    prUrl: ctx.prUrl,
  });

  const { payload } = ctx.task;
  const { projectConfig } = ctx;
  const githubToken = projectConfig.githubToken ?? "";

  const promises: Promise<void>[] = [];

  // Always post on the PR
  promises.push(
    replyToPRComment(ctx.repo, ctx.prNumber, body, githubToken).catch(
      (err) => {
        logger.error({ err }, "Failed to post PR comment");
      },
    ),
  );

  // Post on Linear issue if source is linear
  if (
    payload.source === "linear" &&
    payload.metadata?.linearId &&
    projectConfig.linearApiKey
  ) {
    promises.push(
      postLinearComment(
        payload.metadata.linearId as string,
        body,
        projectConfig.linearApiKey,
      ).catch((err) => {
        logger.error({ err }, "Failed to post Linear comment");
      }),
    );
  }

  // Post on GitHub issue if source is github
  if (
    payload.source === "github" &&
    payload.metadata?.issueNumber &&
    githubToken
  ) {
    promises.push(
      replyToPRComment(
        ctx.repo,
        payload.metadata.issueNumber as number,
        body,
        githubToken,
      ).catch((err) => {
        logger.error({ err }, "Failed to post GitHub issue comment");
      }),
    );
  }

  // Post on Jira ticket if source is jira
  if (
    payload.source === ("jira" as string) &&
    payload.metadata?.jiraIssueKey &&
    projectConfig.jiraDomain &&
    projectConfig.jiraEmail &&
    projectConfig.jiraApiToken
  ) {
    promises.push(
      postJiraComment(
        payload.metadata.jiraIssueKey as string,
        body,
        projectConfig.jiraDomain,
        projectConfig.jiraEmail,
        projectConfig.jiraApiToken,
      ).catch((err) => {
        logger.error({ err }, "Failed to post Jira comment");
      }),
    );
  }

  await Promise.allSettled(promises);
}
