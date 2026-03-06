import type { TaskProvider, IncomingTask, TaskResult, ProjectContext } from "./types";
import { logger } from "../utils/logger";

const LINEAR_API = "https://api.linear.app/graphql";

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  url: string;
  state: { name: string };
  labels: { nodes: Array<{ name: string }> };
}

export class LinearProvider implements TaskProvider {
  name = "linear";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async poll(project: ProjectContext): Promise<IncomingTask[]> {
    if (!project.linearTeamId) return [];

    const query = `
      query {
        issues(filter: {
          team: { key: { eq: "${project.linearTeamId}" } }
          state: { name: { eq: "In Progress" } }
        }, first: 20) {
          nodes {
            id
            identifier
            title
            description
            url
            state { name }
            labels { nodes { name } }
          }
        }
      }
    `;

    try {
      const res = await fetch(LINEAR_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.apiKey,
        },
        body: JSON.stringify({ query }),
      });

      if (!res.ok) {
        logger.error({ status: res.status }, "Linear API error");
        return [];
      }

      const data = (await res.json()) as {
        data?: { issues?: { nodes: LinearIssue[] } };
      };
      const issues = data.data?.issues?.nodes ?? [];
      const tasks: IncomingTask[] = [];

      for (const issue of issues) {
        tasks.push({
          id: `linear-${issue.identifier}`,
          title: issue.title,
          description: issue.description ?? "",
          source: "linear",
          priority: 2,
          type: "new",
          metadata: {
            linearId: issue.id,
            identifier: issue.identifier,
            url: issue.url,
          },
          labels: issue.labels?.nodes?.map((l) => l.name) ?? [],
        });
      }

      return tasks;
    } catch (err) {
      logger.error({ err }, "Failed to poll Linear");
      return [];
    }
  }

  async onComplete(
    project: ProjectContext,
    taskId: string,
    result: TaskResult,
  ): Promise<void> {
    // Extract linear ID from metadata if available
    const linearId = taskId.replace("linear-", "");

    const stateName =
      result.status === "completed" ? "In Review" : "In Progress";

    const mutation = `
      mutation {
        issueUpdate(id: "${linearId}", input: { stateId: "${stateName}" }) {
          success
        }
      }
    `;

    try {
      await fetch(LINEAR_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.apiKey,
        },
        body: JSON.stringify({ query: mutation }),
      });
    } catch (err) {
      logger.error({ err, taskId }, "Failed to update Linear status");
    }
  }
}
