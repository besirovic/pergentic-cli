import { getChangeSummary } from "./git";
import { replyToPRComment } from "./git";
import { logger } from "../utils/logger";
import { fetchWithRetry } from "../utils/http";
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

const MAX_COMMENT_LENGTH = 65536;
const MAX_VERIFICATION_OUTPUT_CHARS = 1500;

function buildCommentBody(ctx: {
  taskId: string;
  taskTitle: string;
  commitMessage: string;
  stats: string;
  prUrl: string;
}): string {
  let body = [
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

  if (body.length > MAX_COMMENT_LENGTH) {
    body = body.slice(0, MAX_COMMENT_LENGTH - 50) + "\n\n[Body truncated due to GitHub character limit]";
  }

  return body;
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

  await fetchWithRetry("https://api.linear.app/graphql", {
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
}

const JIRA_DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;

async function postJiraComment(
  jiraIssueKey: string,
  body: string,
  jiraDomain: string,
  jiraEmail: string,
  jiraApiToken: string,
): Promise<void> {
  if (!JIRA_DOMAIN_RE.test(jiraDomain)) {
    throw new Error(`Invalid jiraDomain: ${jiraDomain}`);
  }

  const auth = Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString("base64");

  await fetchWithRetry(
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
}

async function dispatchCommentToProviders(
  body: string,
  task: Task,
  projectConfig: ProjectConfig,
  repo: string,
  logPrefix: string,
): Promise<void> {
  const { payload } = task;
  const promises: Promise<void>[] = [];

  // Post on Linear issue if source is linear
  if (
    payload.source === "linear" &&
    payload.metadata?.linearId &&
    projectConfig.linearApiKey
  ) {
    const linearId = payload.metadata.linearId;
    if (typeof linearId === "string") {
      promises.push(
        postLinearComment(
          linearId,
          body,
          projectConfig.linearApiKey,
        ).catch((err) => {
          logger.error({ err }, `Failed to post Linear ${logPrefix} comment`);
        }),
      );
    }
  }

  // Post on GitHub issue if source is github
  if (
    payload.source === "github" &&
    payload.metadata?.issueNumber &&
    projectConfig.githubToken
  ) {
    const issueNumber = payload.metadata.issueNumber;
    if (typeof issueNumber === "number") {
      promises.push(
        replyToPRComment(
          repo,
          issueNumber,
          body,
          projectConfig.githubToken,
        ).catch((err) => {
          logger.error({ err }, `Failed to post GitHub ${logPrefix} comment`);
        }),
      );
    }
  }

  // Post on Jira ticket if source is jira
  if (
    payload.source === "jira" &&
    payload.metadata?.jiraIssueKey &&
    projectConfig.jiraDomain &&
    projectConfig.jiraEmail &&
    projectConfig.jiraApiToken
  ) {
    const jiraIssueKey = payload.metadata.jiraIssueKey;
    if (typeof jiraIssueKey === "string") {
      promises.push(
        postJiraComment(
          jiraIssueKey,
          body,
          projectConfig.jiraDomain,
          projectConfig.jiraEmail,
          projectConfig.jiraApiToken,
        ).catch((err) => {
          logger.error({ err }, `Failed to post Jira ${logPrefix} comment`);
        }),
      );
    }
  }

  await Promise.allSettled(promises);
}

export interface VerificationFailureContext {
  task: Task;
  projectConfig: ProjectConfig;
  failedCommand: string;
  output: string;
  retries: number;
}

export async function postVerificationFailureComment(ctx: VerificationFailureContext): Promise<void> {
  const body = [
    "## Verification Failed — pergentic",
    "",
    `**Task:** ${ctx.task.payload.taskId}: ${ctx.task.payload.title}`,
    `**Failed command:** \`${ctx.failedCommand}\``,
    `**Retries exhausted:** ${ctx.retries}`,
    "",
    "**Last error output:**",
    "```",
    ctx.output.slice(-MAX_VERIFICATION_OUTPUT_CHARS),
    "```",
    "",
    "The coding agent was unable to fix this issue after multiple attempts. Manual intervention is required.",
    "",
    "---",
    "*Automated by pergentic*",
  ].join("\n");

  await dispatchCommentToProviders(
    body,
    ctx.task,
    ctx.projectConfig,
    ctx.projectConfig.repo,
    "verification failure",
  );
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

  const { projectConfig } = ctx;
  const githubToken = projectConfig.githubToken ?? "";

  // Always post on the PR, and dispatch to source provider concurrently
  await Promise.allSettled([
    replyToPRComment(ctx.repo, ctx.prNumber, body, githubToken).catch(
      (err) => {
        logger.error({ err }, "Failed to post PR comment");
      },
    ),
    dispatchCommentToProviders(body, ctx.task, projectConfig, ctx.repo, "issue"),
  ]);
}
