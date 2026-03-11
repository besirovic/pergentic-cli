import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractLinearIdentifier, LinearProvider } from "./linear";

vi.mock("../utils/http", () => ({
  fetchWithRetry: vi.fn(),
}));

import { fetchWithRetry } from "../utils/http";

const mockFetch = fetchWithRetry as ReturnType<typeof vi.fn>;

function makeResponse(body: unknown): Response {
  return {
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("extractLinearIdentifier", () => {
	it("extracts identifier from single-agent task ID", () => {
		expect(extractLinearIdentifier("linear-LIN-123")).toBe("LIN-123");
	});

	it("extracts identifier from multi-agent task ID", () => {
		expect(extractLinearIdentifier("linear-LIN-123-claude-code")).toBe("LIN-123");
	});

	it("extracts identifier with model label suffix", () => {
		expect(extractLinearIdentifier("linear-LIN-456-aider-sonnet")).toBe("LIN-456");
	});

	it("handles different team prefixes", () => {
		expect(extractLinearIdentifier("linear-ENG-42")).toBe("ENG-42");
		expect(extractLinearIdentifier("linear-PROJ-9999")).toBe("PROJ-9999");
	});

	it("handles lowercase team prefixes", () => {
		expect(extractLinearIdentifier("linear-eng-42")).toBe("eng-42");
	});

	it("throws for malformed IDs without valid team-number pattern", () => {
		expect(() => extractLinearIdentifier("linear-some-other-format")).toThrow("Invalid Linear task ID format");
	});

	it("throws for empty prefix after linear-", () => {
		expect(() => extractLinearIdentifier("linear-")).toThrow("Invalid Linear task ID format");
	});

	it("throws for garbage input", () => {
		expect(() => extractLinearIdentifier("garbage")).toThrow("Invalid Linear task ID format");
	});

	it("throws for double-prefixed IDs", () => {
		expect(() => extractLinearIdentifier("linear-linear-LIN-123")).toThrow("Invalid Linear task ID format");
	});
});

describe("LinearProvider.fetchTasks", () => {
  let provider: LinearProvider;

  beforeEach(() => {
    provider = new LinearProvider("test-api-key");
    mockFetch.mockReset();
  });

  const project = {
    linearTeamId: "ENG",
    name: "test",
    repoPath: "/tmp/test",
    repoUrl: "https://github.com/test/test",
  };

  it("throws on partial GraphQL response with errors array", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({
      data: { issues: { nodes: [{ id: "1", identifier: "ENG-1", title: "Issue", description: null, url: "http://x", state: { name: "In Progress" }, labels: { nodes: [] } }] } },
      errors: [{ message: "Partial failure: field X unavailable" }],
    }));

    await expect(provider.fetchTasks(project)).rejects.toThrow("GraphQL error (fetchTasks)");
  });

  it("throws when response has only errors and no data", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({
      errors: [{ message: "Unauthorized" }],
    }));

    await expect(provider.fetchTasks(project)).rejects.toThrow("GraphQL error (fetchTasks): Unauthorized");
  });

  it("throws on invalid response structure (no data field)", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({
      somethingUnexpected: true,
    }));

    await expect(provider.fetchTasks(project)).rejects.toThrow("Invalid Linear API response for fetchTasks");
  });

  it("throws on invalid response structure (missing nodes)", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({
      data: { issues: {} },
    }));

    await expect(provider.fetchTasks(project)).rejects.toThrow("Invalid Linear API response for fetchTasks");
  });

  it("returns empty array for valid response with no issues", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({
      data: { issues: { nodes: [] } },
    }));

    const tasks = await provider.fetchTasks(project);
    expect(tasks).toEqual([]);
  });

  it("parses valid issues response correctly", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({
      data: {
        issues: {
          nodes: [
            {
              id: "issue-1",
              identifier: "ENG-42",
              title: "Fix the bug",
              description: "A bug description",
              url: "https://linear.app/issue/ENG-42",
              state: { name: "In Progress" },
              labels: { nodes: [{ name: "backend" }] },
            },
          ],
        },
      },
    }));

    const tasks = await provider.fetchTasks(project);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("linear-ENG-42");
    expect(tasks[0].title).toBe("Fix the bug");
    expect(tasks[0].labels).toEqual(["backend"]);
  });
});
