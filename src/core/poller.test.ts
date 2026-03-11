import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Poller, type PollerConfig } from "./poller";
import { TaskQueue } from "./queue";
import { TaskRunner } from "./runner";
import { DispatchLedger } from "./ledger";

// Mock all heavy dependencies so we can test the polling lifecycle in isolation
vi.mock("../config/loader", () => ({
  loadProjectsRegistry: () => ({ projects: [] }),
}));
vi.mock("../config/cache", () => ({
  getCachedProjectConfig: () => ({}),
}));
vi.mock("../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function createPoller(intervalSeconds = 0.05) {
  const queue = new TaskQueue();
  const runner = { availableSlots: 0, isActive: () => false, run: vi.fn() } as unknown as TaskRunner;
  const ledger = { isDispatched: () => false, markDispatched: vi.fn() } as unknown as DispatchLedger;
  const config: PollerConfig = { pollInterval: intervalSeconds };
  return new Poller(queue, runner, config, ledger);
}

describe("Poller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stop() immediately halts new iterations", async () => {
    const poller = createPoller(0.05);
    let tickCount = 0;
    poller.setAfterPollHook(async () => {
      tickCount++;
    });

    const startPromise = poller.start();
    // Let the first tick resolve
    await vi.advanceTimersByTimeAsync(0);
    await startPromise;
    expect(tickCount).toBe(1);

    poller.stop();

    // Advance well past the poll interval — no more ticks should fire
    await vi.advanceTimersByTimeAsync(500);
    expect(tickCount).toBe(1);
  });

  it("no setTimeout callbacks execute after stop()", async () => {
    const poller = createPoller(0.05);
    const afterPoll = vi.fn().mockResolvedValue(undefined);
    poller.setAfterPollHook(afterPoll);

    const startPromise = poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await startPromise;

    // The first tick has run; a setTimeout is now scheduled
    const callCountAtStop = afterPoll.mock.calls.length;
    poller.stop();

    // Advance timers so the scheduled callback would fire if not cancelled
    await vi.advanceTimersByTimeAsync(1000);
    expect(afterPoll.mock.calls.length).toBe(callCountAtStop);
  });

  it("handles rapid start/stop cycles without leaking timers", async () => {
    const poller = createPoller(0.05);
    const afterPoll = vi.fn().mockResolvedValue(undefined);
    poller.setAfterPollHook(afterPoll);

    // Rapid start/stop cycles
    for (let i = 0; i < 10; i++) {
      const p = poller.start();
      await vi.advanceTimersByTimeAsync(0);
      await p;
      poller.stop();
    }

    const callsAfterCycles = afterPoll.mock.calls.length;

    // Advance timers — no stale callbacks should fire
    await vi.advanceTimersByTimeAsync(5000);
    expect(afterPoll.mock.calls.length).toBe(callsAfterCycles);
  });
});
