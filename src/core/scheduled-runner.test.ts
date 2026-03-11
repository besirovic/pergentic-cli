import { describe, it, expect, vi } from "vitest";
import { ScheduledCommandRunner } from "./scheduled-runner";
import type { Task } from "./queue";
import type { ProjectConfig } from "../config/schema";
import type { WorktreeInfo } from "./worktree";

vi.mock("simple-git", () => ({
  default: () => ({
    status: vi.fn().mockResolvedValue({ files: [] }),
  }),
}));

function makeTask(id: string): Task {
  return {
    id,
    project: "test-project",
    priority: 4,
    type: "scheduled",
    createdAt: Date.now(),
    payload: {
      taskId: id,
      title: `Scheduled ${id}`,
      description: "desc",
      source: "schedule" as const,
      scheduledCommand: "echo hello",
    },
  };
}

const minimalProjectConfig = {
  repo: "https://github.com/test/repo.git",
  branch: "main",
  agent: "claude-code",
} as unknown as ProjectConfig;

const worktree: WorktreeInfo = { path: "/tmp", branch: "feat/test", taskId: "t0" };

function makeRunner() {
  const lifecycle = {
    recordStart: vi.fn().mockResolvedValue(undefined),
    recordSuccess: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
  };
  const prService = {
    createPRFromWorktree: vi.fn().mockResolvedValue({ url: "https://pr/1", number: 1 }),
  };
  const runner = new ScheduledCommandRunner(
    lifecycle as any,
    prService as any,
  );
  return { runner, lifecycle, prService };
}

describe("ScheduledCommandRunner", () => {
  it("succeeds for a fast command within timeout", async () => {
    const { runner } = makeRunner();
    const result = await runner.execute(
      makeTask("t1"), minimalProjectConfig, "proj", worktree, "echo ok", Date.now(),
    );
    expect(result.success).toBe(true);
  });

  it("kills a hanging command and reports failure on timeout", async () => {
    const { runner, lifecycle } = makeRunner();
    const result = await runner.execute(
      makeTask("t2"), minimalProjectConfig, "proj", worktree, "sleep 60", Date.now(), 500,
    );
    expect(result.success).toBe(false);
    expect(lifecycle.recordFailure).toHaveBeenCalledOnce();
    const failureMsg = lifecycle.recordFailure.mock.calls[0][2] as string;
    expect(failureMsg).toContain("timed out");
  }, 10_000);

  it("uses the 30-minute default when no timeout is specified", async () => {
    const { runner } = makeRunner();
    const result = await runner.execute(
      makeTask("t3"), minimalProjectConfig, "proj", worktree, "echo default", Date.now(),
    );
    expect(result.success).toBe(true);
  });
});
