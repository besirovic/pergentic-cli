import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { runAgentWithRetry } from "./agent-runner";
import type { ExecutorContext } from "./executor-types";
import type { AgentSpawner } from "./runner-deps";
import type { Task } from "./queue";
import { TaskPriority } from "./queue";
import type { ProjectConfig } from "../config/schema";

function makeChildProcess(): import("node:child_process").ChildProcess {
  const cp = new EventEmitter() as import("node:child_process").ChildProcess;
  cp.kill = vi.fn().mockReturnValue(true);
  cp.pid = 12345;
  return cp;
}

function makeTask(id: string): Task {
  return {
    id,
    project: "test-project",
    priority: TaskPriority.NEW,
    type: "new",
    createdAt: Date.now(),
    payload: {
      taskId: id,
      title: `Task ${id}`,
      description: "desc",
      source: "github",
    },
  };
}

const minimalProjectConfig: ProjectConfig = {
  repo: "https://github.com/test/repo.git",
  branch: "main",
  agent: "claude-code",
} as unknown as ProjectConfig;

function makeCtx(isActiveFn: () => boolean): ExecutorContext {
  return {
    task: makeTask("t1"),
    projectConfig: minimalProjectConfig,
    projectName: "test-project",
    projectPath: "/tmp/project",
    worktree: { path: "/tmp/wt", branch: "feat/t1" },
    startTime: Date.now(),
    signal: new AbortController().signal,
    setProcess: vi.fn(),
    isActive: isActiveFn,
    getActiveEntry: vi.fn(() => ({ process: null })),
    agent: {} as never,
    agentName: "claude-code",
    baseAgentEnv: {},
    agentOptions: {},
  } as unknown as ExecutorContext;
}

const agentCmd = { command: "echo", args: ["hi"], env: {} };

describe("runAgentWithRetry", () => {
  it("returns successful result when agent exits 0", async () => {
    const cp = makeChildProcess();
    const agentSpawner: AgentSpawner = {
      spawnAgentAndWait: vi.fn().mockReturnValue({
        process: cp,
        result: Promise.resolve({ exitCode: 0, stdout: "done", stderr: "" }),
      }),
    };
    const ctx = makeCtx(() => true);

    const { result, lastAttempt } = await runAgentWithRetry(ctx, agentSpawner, agentCmd);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("done");
    expect(lastAttempt).toBe(0);
    expect(ctx.setProcess).toHaveBeenCalledWith(cp);
    expect(cp.kill).not.toHaveBeenCalled();
  });

  it("kills process and returns cancelled if task is cancelled immediately after spawn (concurrent cancellation)", async () => {
    const cp = makeChildProcess();
    // isActive returns false as soon as checked after setProcess
    const agentSpawner: AgentSpawner = {
      spawnAgentAndWait: vi.fn().mockReturnValue({
        process: cp,
        // result never resolves — but we should short-circuit before awaiting it
        result: new Promise(() => {}),
      }),
    };
    const ctx = makeCtx(() => false);

    const resultPromise = runAgentWithRetry(ctx, agentSpawner, agentCmd);
    const { result } = await resultPromise;

    // Process must be stored via setProcess before the kill check
    expect(ctx.setProcess).toHaveBeenCalledWith(cp);
    // Process must be killed to prevent zombie
    expect(cp.kill).toHaveBeenCalledWith("SIGTERM");
    expect(result.stderr).toBe("cancelled");
    expect(result.exitCode).toBe(-1);
  });

  it("stores process reference before checking isActive, ensuring killability", async () => {
    const cp = makeChildProcess();
    const callOrder: string[] = [];

    const setProcess = vi.fn(() => callOrder.push("setProcess"));
    const isActive = vi.fn(() => {
      callOrder.push("isActive");
      return false;
    });

    const agentSpawner: AgentSpawner = {
      spawnAgentAndWait: vi.fn().mockReturnValue({
        process: cp,
        result: new Promise(() => {}),
      }),
    };

    const ctx = {
      ...makeCtx(isActive),
      setProcess,
    } as unknown as ExecutorContext;

    await runAgentWithRetry(ctx, agentSpawner, agentCmd);

    // setProcess must come before isActive check
    const setIdx = callOrder.indexOf("setProcess");
    const isActiveIdx = callOrder.indexOf("isActive");
    expect(setIdx).toBeGreaterThanOrEqual(0);
    expect(isActiveIdx).toBeGreaterThan(setIdx);
    expect(cp.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("retries on non-zero exit code up to maxRetries", async () => {
    const cp = makeChildProcess();
    let callCount = 0;
    const agentSpawner: AgentSpawner = {
      spawnAgentAndWait: vi.fn().mockImplementation(() => {
        callCount++;
        const exitCode = callCount < 3 ? 1 : 0;
        return {
          process: cp,
          result: Promise.resolve({ exitCode, stdout: "", stderr: "err" }),
        };
      }),
    };

    const projectConfig = {
      ...minimalProjectConfig,
      agentRetry: { maxRetries: 2, baseDelaySeconds: 0 },
    } as unknown as ProjectConfig;

    const ctx = {
      ...makeCtx(() => true),
      projectConfig,
    } as unknown as ExecutorContext;

    const { result, lastAttempt } = await runAgentWithRetry(ctx, agentSpawner, agentCmd);

    expect(result.exitCode).toBe(0);
    expect(lastAttempt).toBe(2);
    expect(agentSpawner.spawnAgentAndWait).toHaveBeenCalledTimes(3);
  });

  it("returns cancelled result if task is cancelled during retry backoff", async () => {
    const cp = makeChildProcess();
    let active = true;
    const agentSpawner: AgentSpawner = {
      spawnAgentAndWait: vi.fn().mockImplementation(() => {
        active = false; // cancel after first spawn
        return {
          process: cp,
          result: Promise.resolve({ exitCode: 1, stdout: "", stderr: "err" }),
        };
      }),
    };

    const projectConfig = {
      ...minimalProjectConfig,
      agentRetry: { maxRetries: 2, baseDelaySeconds: 0 },
    } as unknown as ProjectConfig;

    const ctx = {
      ...makeCtx(() => active),
      projectConfig,
      signal: new AbortController().signal,
    } as unknown as ExecutorContext;

    const { result } = await runAgentWithRetry(ctx, agentSpawner, agentCmd);

    expect(result.stderr).toBe("cancelled");
    expect(agentSpawner.spawnAgentAndWait).toHaveBeenCalledTimes(1);
  });
});
