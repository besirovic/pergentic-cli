import { describe, it, expect, vi, beforeEach } from "vitest";
import { Scheduler } from "./scheduler";
import { TaskQueue } from "./queue";
import type { TaskRunner } from "./runner";

// Mock heavy I/O dependencies
vi.mock("../config/loader", () => ({
  loadProjectsRegistry: vi.fn(() => ({
    projects: [{ path: "/fake/project" }],
  })),
}));

vi.mock("../config/schedules", () => ({
  loadSchedulesConfig: vi.fn(),
  updateLastRun: vi.fn(),
  readPromptFile: vi.fn(() => "Do the thing"),
  PROMPT_TEMPLATE: vi.fn(() => ""),
}));

vi.mock("../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { loadProjectsRegistry } from "../config/loader";
import { loadSchedulesConfig, updateLastRun } from "../config/schedules";

const mockLoadProjectsRegistry = vi.mocked(loadProjectsRegistry);
const mockLoadSchedulesConfig = vi.mocked(loadSchedulesConfig);
const mockUpdateLastRun = vi.mocked(updateLastRun);

function makeSchedule(overrides: Record<string, unknown> = {}) {
  return {
    id: "sched-1",
    name: "My Schedule",
    type: "prompt" as const,
    cron: "* * * * *",
    enabled: true,
    prompt: "prompt.md",
    lastRun: undefined,
    ...overrides,
  };
}

function makeRunner(): TaskRunner {
  return { availableSlots: 1, isActive: () => false, run: vi.fn() } as unknown as TaskRunner;
}

describe("Scheduler.checkDue", () => {
  let queue: TaskQueue;
  let scheduler: Scheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    queue = new TaskQueue();
    scheduler = new Scheduler(queue, makeRunner());

    // Default: one project with one due schedule
    mockLoadProjectsRegistry.mockReturnValue({
      projects: [{ path: "/fake/project" }],
    } as ReturnType<typeof loadProjectsRegistry>);

    mockLoadSchedulesConfig.mockReturnValue({
      schedules: [makeSchedule()],
    } as ReturnType<typeof loadSchedulesConfig>);
  });

  it("removes schedule from active set when updateLastRun throws", async () => {
    mockUpdateLastRun.mockImplementation(() => {
      throw new Error("disk full");
    });

    await scheduler.checkDue();

    // Schedule must NOT be stuck in active — a second checkDue should re-run it
    mockUpdateLastRun.mockImplementation(() => undefined);
    await scheduler.checkDue();

    // updateLastRun called twice (once failed, once succeeded)
    expect(mockUpdateLastRun).toHaveBeenCalledTimes(2);
  });

  it("schedule runs on next checkDue after updateLastRun failure", async () => {
    mockUpdateLastRun
      .mockImplementationOnce(() => { throw new Error("transient error"); })
      .mockImplementation(() => undefined);

    await scheduler.checkDue();
    // Active set should be cleared after failure
    // Second call should dispatch again
    await scheduler.checkDue();

    expect(mockUpdateLastRun).toHaveBeenCalledTimes(2);
  });

  it("active set never retains stale IDs after any dispatch error", async () => {
    mockUpdateLastRun.mockImplementation(() => {
      throw new Error("write error");
    });

    // Run multiple times — each should attempt dispatch (not skip due to stale active)
    for (let i = 0; i < 3; i++) {
      await scheduler.checkDue();
    }

    expect(mockUpdateLastRun).toHaveBeenCalledTimes(3);
  });

  it("keeps schedule in active when dispatch succeeds (prevents double-queuing)", async () => {
    mockUpdateLastRun.mockImplementation(() => undefined);

    await scheduler.checkDue();
    const firstCallCount = mockUpdateLastRun.mock.calls.length;
    expect(firstCallCount).toBe(1);

    // Second checkDue should skip (still active, running)
    await scheduler.checkDue();
    expect(mockUpdateLastRun).toHaveBeenCalledTimes(1);
  });
});
