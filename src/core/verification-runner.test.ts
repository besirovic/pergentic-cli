import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { VerificationRunner } from "./verification-runner";
import type { Task } from "./queue";
import { TaskPriority } from "./queue";
import type { ProjectConfig } from "../config/schema";

vi.mock("./verify", () => ({
  runVerificationCommands: vi.fn(),
  spawnAgentAndWait: vi.fn(),
  buildVerificationFixPrompt: vi.fn(() => "fix this"),
}));

vi.mock("./comments", () => ({
  postVerificationFailureComment: vi.fn(),
}));

vi.mock("./task-lifecycle");

import { runVerificationCommands, spawnAgentAndWait } from "./verify";
import { TaskLifecycle } from "./task-lifecycle";

function makeChildProcess(): import("node:child_process").ChildProcess {
  const cp = new EventEmitter() as import("node:child_process").ChildProcess;
  cp.kill = vi.fn().mockReturnValue(true);
  cp.pid = 12345;
  return cp;
}

function makeTask(): Task {
  return {
    id: "task-1",
    project: "test-project",
    priority: TaskPriority.NEW,
    type: "new",
    createdAt: Date.now(),
    payload: {
      taskId: "task-1",
      title: "Test Task",
      description: "desc",
      source: "github",
    },
  };
}

const minimalConfig = {
  repo: "https://github.com/test/repo.git",
  branch: "main",
  agent: "claude-code",
} as unknown as ProjectConfig;

const minimalAgent = {
  buildCommand: vi.fn(() => ({ command: "echo", args: ["fix"], env: {} })),
} as never;

const minimalWorktree = { path: "/tmp/wt", branch: "feat/task-1" };

describe("VerificationRunner — cancellation process termination", () => {
  let runner: VerificationRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    const lifecycle = { recordFailure: vi.fn() } as unknown as TaskLifecycle;
    runner = new VerificationRunner(lifecycle);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends SIGTERM and schedules SIGKILL when task is cancelled during fix", async () => {
    const cp = makeChildProcess();

    // First verification fails
    vi.mocked(runVerificationCommands).mockResolvedValueOnce({
      success: false,
      failedCommand: "npm test",
      output: "Test failed",
    });

    // spawnAgentAndWait returns a handle that never resolves (simulating long-running fix)
    vi.mocked(spawnAgentAndWait).mockReturnValue({
      process: cp,
      result: new Promise(() => {}), // never resolves
    });

    // Task is already cancelled when we check getActiveTask
    const getActiveTask = vi.fn(() => undefined);

    const resultPromise = runner.runVerificationLoop(
      makeTask(),
      minimalConfig,
      "test-project",
      minimalWorktree,
      {},
      {},
      minimalAgent,
      1000,
      ["npm test"],
      3,
      getActiveTask,
    );

    const result = await resultPromise;

    expect(result).toBe(false);
    expect(cp.kill).toHaveBeenCalledWith("SIGTERM");

    // SIGKILL should not have fired yet (timer still pending)
    expect(cp.kill).toHaveBeenCalledTimes(1);

    // Advance past SIGKILL_DELAY_MS (10 seconds)
    vi.advanceTimersByTime(10_001);

    expect(cp.kill).toHaveBeenCalledWith("SIGKILL");
    expect(cp.kill).toHaveBeenCalledTimes(2);
  });

  it("does not leak processes when cancellation occurs — process is not left running", async () => {
    const cp = makeChildProcess();

    vi.mocked(runVerificationCommands).mockResolvedValueOnce({
      success: false,
      failedCommand: "npm test",
      output: "Test failed",
    });

    vi.mocked(spawnAgentAndWait).mockReturnValue({
      process: cp,
      result: new Promise(() => {}),
    });

    const getActiveTask = vi.fn(() => undefined);

    await runner.runVerificationLoop(
      makeTask(),
      minimalConfig,
      "test-project",
      minimalWorktree,
      {},
      {},
      minimalAgent,
      1000,
      ["npm test"],
      3,
      getActiveTask,
    );

    // SIGTERM must always be sent — no zombie processes
    expect(cp.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
