import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { TaskRunner } from "./runner";
import { TaskPriority, type Task } from "./queue";
import type { RunnerDeps } from "./runner-deps";
import type { GlobalConfig, ProjectConfig } from "../config/schema";

/**
 * Minimal stubs for dependencies. Only the paths exercised by each test
 * need real behaviour — everything else is a no-op / identity stub.
 */

function makeTask(id: string, type: Task["type"] = "new"): Task {
  return {
    id,
    project: "test-project",
    priority: TaskPriority.NEW,
    type,
    createdAt: Date.now(),
    payload: {
      taskId: id,
      title: `Task ${id}`,
      description: "desc",
      source: "github",
    },
  };
}

const minimalGlobalConfig: GlobalConfig = {
  projects: {},
} as unknown as GlobalConfig;

const minimalProjectConfig: ProjectConfig = {
  repo: "https://github.com/test/repo.git",
  branch: "main",
  agent: "claude-code",
  claude: { agentTimeout: 3600 },
} as unknown as ProjectConfig;

function makeChildProcess(): import("node:child_process").ChildProcess {
  const cp = new EventEmitter() as import("node:child_process").ChildProcess;
  cp.kill = vi.fn().mockReturnValue(true);
  cp.pid = 12345;
  return cp;
}

function stubDeps(overrides: Partial<RunnerDeps> = {}): RunnerDeps {
  return {
    worktree: {
      ensureRepoClone: vi.fn().mockResolvedValue("/tmp/clone"),
      createWorktree: vi.fn().mockResolvedValue({ path: "/tmp/wt", branch: "feat/t" }),
    },
    git: {
      pullBranch: vi.fn().mockResolvedValue(undefined),
      amendAndForcePush: vi.fn().mockResolvedValue(undefined),
    },
    feedback: {
      loadHistory: vi.fn().mockResolvedValue(null),
      initHistory: vi.fn().mockResolvedValue({ rounds: [] }),
      addFeedbackRound: vi.fn().mockResolvedValue({ rounds: [] }),
      buildFeedbackPrompt: vi.fn().mockReturnValue("prompt"),
    },
    agentResolver: {
      resolveAgent: vi.fn().mockReturnValue({
        name: "claude-code",
        tools: [],
        buildCommand: vi.fn().mockReturnValue({ command: "echo", args: ["hi"], env: {} }),
        isInstalled: vi.fn().mockResolvedValue(true),
      }),
    },
    agentSpawner: {
      spawnAgentAndWait: vi.fn().mockReturnValue({
        process: makeChildProcess(),
        result: Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }),
      }),
    },
    lifecycle: {
      recordStart: vi.fn().mockResolvedValue(undefined),
      recordSuccess: vi.fn().mockResolvedValue(undefined),
      recordFailure: vi.fn().mockResolvedValue(undefined),
    },
    prService: {
      createPRFromWorktree: vi.fn().mockResolvedValue({ url: "https://pr/1", number: 1 }),
    },
    verification: {
      runVerificationLoop: vi.fn().mockResolvedValue(true),
    },
    scheduledRunner: {
      execute: vi.fn().mockResolvedValue({ success: true }),
    },
    ...overrides,
  };
}

function createRunner(deps?: Partial<RunnerDeps>): TaskRunner {
  return new TaskRunner({
    maxConcurrent: 4,
    globalConfig: minimalGlobalConfig,
    deps: stubDeps(deps),
  });
}

// ---------------------------------------------------------------------------
// Tests: delete-before-emit invariant
// ---------------------------------------------------------------------------

describe("TaskRunner delete-before-emit ordering", () => {
  it("taskCompleted: isActive returns false inside the listener (success path)", async () => {
    const runner = createRunner();
    const task = makeTask("t1");

    const observed: boolean[] = [];
    runner.on("taskCompleted", (t) => {
      observed.push(runner.isActive(t.id));
    });

    await runner.run(task, minimalProjectConfig, "/tmp/proj");

    // Wait for the async executeTask to finish
    await vi.waitFor(() => expect(observed.length).toBeGreaterThanOrEqual(1), { timeout: 2000 });

    expect(observed[0]).toBe(false);
  });

  it("taskFailed: isActive returns false inside the listener (agent exit code != 0)", async () => {
    const runner = createRunner({
      agentSpawner: {
        spawnAgentAndWait: vi.fn().mockReturnValue({
          process: makeChildProcess(),
          result: Promise.resolve({ exitCode: 1, stdout: "", stderr: "error" }),
        }),
      },
    });
    const task = makeTask("t2");

    const observed: boolean[] = [];
    runner.on("taskFailed", (t) => {
      observed.push(runner.isActive(t.id));
    });

    await runner.run(task, minimalProjectConfig, "/tmp/proj");
    await vi.waitFor(() => expect(observed.length).toBeGreaterThanOrEqual(1), { timeout: 2000 });

    expect(observed[0]).toBe(false);
  });

  it("taskFailed: isActive returns false inside the listener (post-agent error)", async () => {
    const runner = createRunner({
      prService: {
        createPRFromWorktree: vi.fn().mockRejectedValue(new Error("PR creation failed")),
      },
    });
    const task = makeTask("t3");

    const observed: boolean[] = [];
    runner.on("taskFailed", (t) => {
      observed.push(runner.isActive(t.id));
    });

    await runner.run(task, minimalProjectConfig, "/tmp/proj");
    await vi.waitFor(() => expect(observed.length).toBeGreaterThanOrEqual(1), { timeout: 2000 });

    expect(observed[0]).toBe(false);
  });

  it("taskCompleted: isActive returns false for scheduled command success", async () => {
    const runner = createRunner();
    const task = makeTask("t4", "scheduled");
    task.payload = {
      ...task.payload,
      source: "schedule",
      scheduledCommand: "echo ok",
    };

    const observed: boolean[] = [];
    runner.on("taskCompleted", (t) => {
      observed.push(runner.isActive(t.id));
    });

    await runner.run(task, minimalProjectConfig, "/tmp/proj");
    await vi.waitFor(() => expect(observed.length).toBeGreaterThanOrEqual(1), { timeout: 2000 });

    expect(observed[0]).toBe(false);
  });

  it("taskFailed: isActive returns false for scheduled command failure", async () => {
    const runner = createRunner({
      scheduledRunner: {
        execute: vi.fn().mockResolvedValue({ success: false }),
      },
    });
    const task = makeTask("t5", "scheduled");
    task.payload = {
      ...task.payload,
      source: "schedule",
      scheduledCommand: "failing-cmd",
    };

    const observed: boolean[] = [];
    runner.on("taskFailed", (t) => {
      observed.push(runner.isActive(t.id));
    });

    await runner.run(task, minimalProjectConfig, "/tmp/proj");
    await vi.waitFor(() => expect(observed.length).toBeGreaterThanOrEqual(1), { timeout: 2000 });

    expect(observed[0]).toBe(false);
  });
});
