import type { IncomingTask, TaskResult, ProjectContext } from "./types";
import { BaseProvider } from "./base";
import { TaskPriority } from "../core/queue";
import { logger } from "../utils/logger";
import { fetchWithRetry } from "../utils/http";

const LINEAR_API = "https://api.linear.app/graphql";

interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message: string }>;
}

function checkGraphQLErrors(
  response: GraphQLResponse,
  context: string,
): void {
  if (response.errors?.length) {
    const messages = response.errors.map((e) => e.message).join("; ");
    throw new Error(`GraphQL error (${context}): ${messages}`);
  }
}

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  url: string;
  state: { name: string };
  labels: { nodes: Array<{ name: string }> };
}

export class LinearProvider extends BaseProvider {
  name = "linear";
  private apiKey: string;

  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;
  }

  async fetchTasks(project: ProjectContext): Promise<IncomingTask[]> {
    if (!project.linearTeamId) return [];

    const query = `
      query($teamId: String!) {
        issues(filter: {
          team: { key: { eq: $teamId } }
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

    const res = await fetchWithRetry(LINEAR_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.apiKey,
      },
      body: JSON.stringify({
        query,
        variables: { teamId: project.linearTeamId },
      }),
    });

    const data = (await res.json()) as GraphQLResponse<{
      issues?: { nodes: LinearIssue[] };
    }>;
    checkGraphQLErrors(data, "fetchTasks");
    const issues = data.data?.issues?.nodes ?? [];
    const tasks: IncomingTask[] = [];

    for (const issue of issues) {
      tasks.push({
        id: `linear-${issue.identifier}`,
        title: issue.title,
        description: issue.description ?? "",
        source: "linear",
        priority: TaskPriority.NEW,
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
  }

  async onComplete(
    project: ProjectContext,
    taskId: string,
    result: TaskResult,
  ): Promise<void> {
    const linearId = taskId.replace("linear-", "");

    const stateName =
      result.status === "completed" ? "In Review" : "In Progress";

    try {
      // First, look up the issue's team and resolve the state ID by name
      const stateQuery = `
        query($issueId: String!) {
          issue(id: $issueId) {
            team {
              states(filter: { name: { eq: "${stateName}" } }) {
                nodes { id }
              }
            }
          }
        }
      `;

      const stateRes = await fetchWithRetry(LINEAR_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.apiKey,
        },
        body: JSON.stringify({
          query: stateQuery,
          variables: { issueId: linearId },
        }),
      });

      const stateData = (await stateRes.json()) as GraphQLResponse<{
        issue?: { team?: { states?: { nodes: Array<{ id: string }> } } };
      }>;
      checkGraphQLErrors(stateData, "resolveState");

      const stateId =
        stateData.data?.issue?.team?.states?.nodes?.[0]?.id;
      if (!stateId) {
        throw new Error(
          `Could not resolve Linear state "${stateName}" for issue ${linearId}`,
        );
      }

      // Now update the issue with the resolved state ID
      const mutation = `
        mutation($issueId: String!, $stateId: String!) {
          issueUpdate(id: $issueId, input: { stateId: $stateId }) {
            success
          }
        }
      `;

      const updateRes = await fetchWithRetry(LINEAR_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.apiKey,
        },
        body: JSON.stringify({
          query: mutation,
          variables: { issueId: linearId, stateId },
        }),
      });

      const updateData = (await updateRes.json()) as GraphQLResponse<{
        issueUpdate?: { success: boolean };
      }>;
      checkGraphQLErrors(updateData, "issueUpdate");
    } catch (err) {
      logger.error({ err, taskId }, "Failed to update Linear status");
    }
  }
}
