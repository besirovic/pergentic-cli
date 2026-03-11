import { describe, it, expect } from "vitest";
import { LinearMetadataSchema, GitHubMetadataSchema, JiraMetadataSchema } from "./comments";

describe("LinearMetadataSchema", () => {
  it("accepts valid linear metadata", () => {
    const result = LinearMetadataSchema.safeParse({ linearId: "LIN-123" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.linearId).toBe("LIN-123");
  });

  it("rejects linearId as a number (correct field name, wrong type)", () => {
    const result = LinearMetadataSchema.safeParse({ linearId: 123 });
    expect(result.success).toBe(false);
  });

  it("rejects missing linearId", () => {
    const result = LinearMetadataSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects linearId as null", () => {
    const result = LinearMetadataSchema.safeParse({ linearId: null });
    expect(result.success).toBe(false);
  });

  it("rejects linearId as boolean", () => {
    const result = LinearMetadataSchema.safeParse({ linearId: true });
    expect(result.success).toBe(false);
  });
});

describe("GitHubMetadataSchema", () => {
  it("accepts valid github metadata", () => {
    const result = GitHubMetadataSchema.safeParse({ issueNumber: 42 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.issueNumber).toBe(42);
  });

  it("rejects issueNumber as a string (correct field name, wrong type)", () => {
    const result = GitHubMetadataSchema.safeParse({ issueNumber: "42" });
    expect(result.success).toBe(false);
  });

  it("rejects missing issueNumber", () => {
    const result = GitHubMetadataSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects issueNumber as zero (not positive)", () => {
    const result = GitHubMetadataSchema.safeParse({ issueNumber: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects negative issueNumber", () => {
    const result = GitHubMetadataSchema.safeParse({ issueNumber: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects float issueNumber", () => {
    const result = GitHubMetadataSchema.safeParse({ issueNumber: 1.5 });
    expect(result.success).toBe(false);
  });
});

describe("JiraMetadataSchema", () => {
  it("accepts valid jira metadata", () => {
    const result = JiraMetadataSchema.safeParse({ jiraIssueKey: "PROJ-456" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.jiraIssueKey).toBe("PROJ-456");
  });

  it("rejects jiraIssueKey as a number (correct field name, wrong type)", () => {
    const result = JiraMetadataSchema.safeParse({ jiraIssueKey: 456 });
    expect(result.success).toBe(false);
  });

  it("rejects missing jiraIssueKey", () => {
    const result = JiraMetadataSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
