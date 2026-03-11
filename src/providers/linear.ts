import type { IncomingTask, TaskResult, ProjectContext } from "./types";
import { BaseProvider } from "./base";
import { TaskPriority } from "../core/queue";
import { logger } from "../utils/logger";
import { fetchWithRetry } from "../utils/http";
import { LRUCache } from "../utils/lru-cache";
import { z } from "zod";

const LINEAR_API = "https://api.linear.app/graphql";

interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message: string }>;
}

const StateQueryResponseSchema = z.object({
  data: z.object({
    issue: z.object({
      team: z.object({
        states: z.object({
          nodes: z.array(z.object({ id: z.string() })),
        }),
      }),
    }),
  }),
});

const IssueMutationResponseSchema = z.object({
  data: z.object({
    issueUpdate: z.object({
      success: z.boolean(),
    }),
  }),
});

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

/**
 * Extract the Linear issue identifier (e.g. "LIN-123") from a task ID.
 * Handles both single-agent IDs ("linear-LIN-123") and multi-agent
 * dispatch IDs ("linear-LIN-123-claude-code").
 */
export function extractLinearIdentifier(taskId: string): string {
  const match = taskId.match(/^linear-([A-Za-z]+-\d+)/);
  if (!match) {
    throw new Error(`Invalid Linear task ID format: expected linear-TEAM-123, got: ${taskId}`);
  }
  return match[1];
}

export class LinearProvider extends BaseProvider {
  name = "linear";
  private apiKey: string;
  private stateIdCache = new LRUCache<string, string>(256);

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
    const linearId = extractLinearIdentifier(taskId);

    const stateName =
      result.status === "completed" ? "In Review" : "In Progress";

    try {
      // Resolve state ID (with cache to avoid redundant GraphQL lookups)
      const cacheKey = `${linearId}:${stateName}`;
      let stateId = this.stateIdCache.get(cacheKey);

      if (!stateId) {
        const stateQuery = `
          query($issueId: String!, $stateName: String!) {
            issue(id: $issueId) {
              team {
                states(filter: { name: { eq: $stateName } }) {
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
            variables: { issueId: linearId, stateName },
          }),
        });

        const stateRaw = await stateRes.json();
        checkGraphQLErrors(stateRaw as GraphQLResponse, "resolveState");
        const stateParsed = StateQueryResponseSchema.safeParse(stateRaw);
        if (!stateParsed.success) {
          throw new Error(
            `Could not resolve Linear state "${stateName}" for issue ${linearId}`,
          );
        }

        stateId = stateParsed.data.data.issue.team.states.nodes[0]?.id;
        if (!stateId) {
          throw new Error(
            `Could not resolve Linear state "${stateName}" for issue ${linearId}`,
          );
        }
        this.stateIdCache.set(cacheKey, stateId);
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

      const updateRaw = await updateRes.json();
      checkGraphQLErrors(updateRaw as GraphQLResponse, "issueUpdate");
      const updateParsed = IssueMutationResponseSchema.safeParse(updateRaw);
      if (!updateParsed.success) {
        throw new Error(`Unexpected Linear API response for issueUpdate: ${JSON.stringify(updateRaw)}`);
      }
    } catch (err) {
      logger.error({ err, taskId }, "Failed to update Linear status");
    }
  }
}
