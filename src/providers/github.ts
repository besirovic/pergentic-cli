import type { IncomingTask, TaskResult, ProjectContext } from "./types";
import { BaseProvider } from "./base";
import { TaskPriority } from "../core/queue";
import { parseOwnerRepo } from "../core/git";
import { logger } from "../utils/logger";
import { fetchWithRetry } from "../utils/http";
import { LIMITS } from "../config/constants";

const GITHUB_API = "https://api.github.com";

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  assignees: Array<{ login: string }>;
  labels: Array<{ name: string }>;
}

interface GitHubComment {
  id: number;
  body: string;
  user: { login: string };
  created_at: string;
  pull_request_url?: string;
}

export class GitHubProvider extends BaseProvider {
  name = "github";
  private token: string;

  constructor(token: string) {
    super();
    this.token = token;
  }

  private async githubFetch(
    url: string,
  ): Promise<Response> {
    return fetchWithRetry(url, {
      headers: {
        Authorization: `token ${this.token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
  }

  async fetchTasks(project: ProjectContext): Promise<IncomingTask[]> {
    let parsed: { owner: string; repo: string };
    try {
      parsed = parseOwnerRepo(project.repo);
    } catch (err) {
      logger.warn({ err, repo: project.repo }, "Failed to parse GitHub owner/repo, skipping");
      return [];
    }

    const tasks: IncomingTask[] = [];

    // Poll for assigned issues
    try {
      const issuesUrl = `${GITHUB_API}/repos/${parsed.owner}/${parsed.repo}/issues?state=open&assignee=*&per_page=20`;
      const res = await this.githubFetch(issuesUrl);

      if (res.ok) {
        const issues = (await res.json()) as GitHubIssue[];
        for (const issue of issues) {
          // Skip pull requests (they also show up in issues API)
          if ("pull_request" in issue) continue;

          tasks.push({
            id: `github-${issue.number}`,
            title: issue.title,
            description: issue.body ?? "",
            source: "github",
            priority: TaskPriority.NEW,
            type: "new",
            metadata: {
              issueNumber: issue.number,
              owner: parsed.owner,
              repo: parsed.repo,
            },
            labels: issue.labels.map((l) => l.name),
          });
        }
      } else {
        logger.error({ status: res.status, statusText: res.statusText }, "GitHub issues API error");
      }
    } catch (err) {
      logger.error({ err }, "Failed to poll GitHub issues");
    }

    // Poll for PR comments on managed branches
    try {
      const since = new Date(Date.now() - LIMITS.COMMENT_POLL_WINDOW_MS).toISOString();
      const commentsUrl = `${GITHUB_API}/repos/${parsed.owner}/${parsed.repo}/issues/comments?since=${since}&per_page=50`;
      const res = await this.githubFetch(commentsUrl);

      if (res.ok) {
        const comments = (await res.json()) as GitHubComment[];

        for (const comment of comments) {
          // Only process PR comments (they have pull_request_url)
          if (!comment.pull_request_url) continue;

          tasks.push({
            id: `github-comment-${comment.id}`,
            title: "PR Feedback",
            description: comment.body,
            source: "github",
            priority: TaskPriority.FEEDBACK,
            type: "feedback",
            metadata: {
              commentId: comment.id,
              user: comment.user.login,
              owner: parsed.owner,
              repo: parsed.repo,
            },
            labels: [],
          });
        }
      } else {
        logger.error({ status: res.status, statusText: res.statusText }, "GitHub PR comments API error");
      }
    } catch (err) {
      logger.error({ err }, "Failed to poll GitHub PR comments");
    }

    return tasks;
  }

  async onComplete(
    _project: ProjectContext,
    _taskId: string,
    _result: TaskResult,
  ): Promise<void> {
    // GitHub issues are closed via PR merge, no action needed
  }
}
