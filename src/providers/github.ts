import type { TaskProvider, IncomingTask, TaskResult, ProjectContext } from "./types";
import { logger } from "../utils/logger";

const GITHUB_API = "https://api.github.com";

function parseRepo(repoUrl: string): { owner: string; repo: string } | null {
  // Handle git@github.com:owner/repo.git and https://github.com/owner/repo
  const sshMatch = repoUrl.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
  return null;
}

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

export class GitHubProvider implements TaskProvider {
  name = "github";
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async githubFetch(
    url: string,
  ): Promise<Response> {
    return fetch(url, {
      headers: {
        Authorization: `token ${this.token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
  }

  async poll(project: ProjectContext): Promise<IncomingTask[]> {
    const parsed = parseRepo(project.repo);
    if (!parsed) return [];

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
            priority: 2,
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
      const since = new Date(Date.now() - 120_000).toISOString();
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
            priority: 1, // Feedback is highest priority
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
