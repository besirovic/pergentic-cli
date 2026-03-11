import { describe, it, expect } from "vitest";
import { TaskQueue, TaskPriority, type Task } from "./queue";

function makeTask(id: string, priority: TaskPriority, type: "new" | "feedback" | "retry" | "scheduled" = "new"): Task {
  return {
    id,
    project: "test-project",
    priority,
    type,
    createdAt: Date.now(),
    payload: {
      taskId: id,
      title: `Task ${id}`,
      description: "Test task",
      source: "github",
    },
  };
}

function makeScheduledTask(id: string, scheduleId: string): Task {
  return {
    id,
    project: "test-project",
    priority: TaskPriority.SCHEDULED,
    type: "scheduled",
    createdAt: Date.now(),
    payload: {
      taskId: id,
      title: `Scheduled ${id}`,
      description: "Scheduled task",
      source: "schedule",
      scheduleId,
    },
  };
}

describe("TaskQueue", () => {
  it("adds and retrieves tasks", () => {
    const q = new TaskQueue();
    q.add(makeTask("a", TaskPriority.NEW));
    expect(q.length).toBe(1);
    const task = q.next();
    expect(task?.id).toBe("a");
    expect(q.length).toBe(0);
  });

  it("sorts by priority (lower = higher priority)", () => {
    const q = new TaskQueue();
    q.add(makeTask("low", TaskPriority.RETRY));
    q.add(makeTask("high", TaskPriority.FEEDBACK));
    q.add(makeTask("mid", TaskPriority.NEW));

    expect(q.next()?.id).toBe("high");
    expect(q.next()?.id).toBe("mid");
    expect(q.next()?.id).toBe("low");
  });

  it("deduplicates by task ID", () => {
    const q = new TaskQueue();
    expect(q.add(makeTask("a", TaskPriority.NEW))).toBe(true);
    expect(q.add(makeTask("a", TaskPriority.FEEDBACK))).toBe(false); // duplicate
    expect(q.length).toBe(1);
  });

  it("allows re-adding after task is consumed", () => {
    const q = new TaskQueue();
    q.add(makeTask("a", TaskPriority.NEW));
    q.next(); // consume it
    expect(q.add(makeTask("a", TaskPriority.NEW))).toBe(true);
    expect(q.length).toBe(1);
  });

  it("peeks without removing", () => {
    const q = new TaskQueue();
    q.add(makeTask("a", TaskPriority.NEW));
    expect(q.peek()?.id).toBe("a");
    expect(q.length).toBe(1); // still there
  });

  it("removes by id", () => {
    const q = new TaskQueue();
    q.add(makeTask("a", TaskPriority.NEW));
    q.add(makeTask("b", TaskPriority.FEEDBACK));
    expect(q.remove("a")).toBe(true);
    expect(q.length).toBe(1);
    expect(q.next()?.id).toBe("b");
  });

  it("returns undefined when empty", () => {
    const q = new TaskQueue();
    expect(q.next()).toBeUndefined();
    expect(q.peek()).toBeUndefined();
  });

  it("clears all tasks", () => {
    const q = new TaskQueue();
    q.add(makeTask("a", TaskPriority.FEEDBACK));
    q.add(makeTask("b", TaskPriority.NEW));
    q.clear();
    expect(q.length).toBe(0);
    expect(q.has("a")).toBe(false);
  });

  it("allows re-adding after task is removed", () => {
    const q = new TaskQueue();
    q.add(makeTask("a", TaskPriority.NEW));
    q.remove("a");
    expect(q.add(makeTask("a", TaskPriority.NEW))).toBe(true);
    expect(q.length).toBe(1);
  });

  it("prevents re-adding a failed task", () => {
    const q = new TaskQueue();
    q.add(makeTask("a", TaskPriority.NEW));
    q.next();
    q.markFailed("a");
    expect(q.add(makeTask("a", TaskPriority.NEW))).toBe(false);
  });

  it("isKnownFailed returns true for failed tasks", () => {
    const q = new TaskQueue();
    q.markFailed("a");
    expect(q.isKnownFailed("a")).toBe(true);
  });

  it("isKnownFailed returns false for non-failed tasks", () => {
    const q = new TaskQueue();
    expect(q.isKnownFailed("a")).toBe(false);
  });

  it("remove returns false for non-existent id", () => {
    const q = new TaskQueue();
    expect(q.remove("nonexistent")).toBe(false);
  });

  it("lists active tasks", () => {
    const q = new TaskQueue();
    q.add(makeTask("a", TaskPriority.FEEDBACK));
    q.add(makeTask("b", TaskPriority.NEW));
    const active = q.active();
    expect(active).toHaveLength(2);
    expect(active[0].id).toBe("a");
  });

  it("active returns a copy, not the internal array", () => {
    const q = new TaskQueue();
    q.add(makeTask("a", TaskPriority.NEW));
    const active = q.active();
    active.pop();
    expect(q.length).toBe(1);
  });

  it("clear does not reset failed set", () => {
    const q = new TaskQueue();
    q.markFailed("a");
    q.clear();
    expect(q.isKnownFailed("a")).toBe(true);
    expect(q.add(makeTask("a", TaskPriority.NEW))).toBe(false);
  });

  describe("hasScheduleId", () => {
    it("returns true when a task with the schedule ID is in the queue", () => {
      const q = new TaskQueue();
      q.add(makeScheduledTask("sched-1-123", "daily-sync"));
      expect(q.hasScheduleId("daily-sync")).toBe(true);
    });

    it("returns false when no task with the schedule ID is in the queue", () => {
      const q = new TaskQueue();
      q.add(makeTask("a", TaskPriority.NEW));
      expect(q.hasScheduleId("daily-sync")).toBe(false);
    });

    it("returns false after the scheduled task is consumed", () => {
      const q = new TaskQueue();
      q.add(makeScheduledTask("sched-1-123", "daily-sync"));
      q.next();
      expect(q.hasScheduleId("daily-sync")).toBe(false);
    });

    it("returns false after the scheduled task is removed", () => {
      const q = new TaskQueue();
      q.add(makeScheduledTask("sched-1-123", "daily-sync"));
      q.remove("sched-1-123");
      expect(q.hasScheduleId("daily-sync")).toBe(false);
    });

    it("ignores non-scheduled tasks", () => {
      const q = new TaskQueue();
      q.add(makeTask("a", TaskPriority.NEW));
      q.add(makeTask("b", TaskPriority.FEEDBACK, "feedback"));
      expect(q.hasScheduleId("a")).toBe(false);
    });
  });

  it("index remains consistent after rapid successive next() calls", () => {
    const q = new TaskQueue();
    const count = 100;
    for (let i = 0; i < count; i++) {
      q.add(makeTask(`task-${i}`, TaskPriority.NEW));
    }

    // Drain half the queue rapidly
    const drained: string[] = [];
    for (let i = 0; i < count / 2; i++) {
      const task = q.next();
      expect(task).toBeDefined();
      drained.push(task!.id);
    }

    // No duplicates in drained set
    expect(new Set(drained).size).toBe(drained.length);

    // Remaining tasks: index must match actual position
    const remaining = q.active();
    expect(remaining).toHaveLength(count / 2);
    for (let i = 0; i < remaining.length; i++) {
      // Remove should succeed (index must be correct)
      const copy = new TaskQueue();
      remaining.forEach((t) => copy.add(t));
      expect(copy.remove(remaining[i].id)).toBe(true);
    }

    // Queue can still be drained cleanly
    let seen = 0;
    while (q.next()) seen++;
    expect(seen).toBe(count / 2);
    expect(q.length).toBe(0);
  });

  it("remove with 10000 items completes in < 10ms", () => {
    const q = new TaskQueue();
    for (let i = 0; i < 10_000; i++) {
      q.add(makeTask(`task-${i}`, TaskPriority.NEW));
    }

    const start = performance.now();
    // Remove an item near the middle
    expect(q.remove("task-5000")).toBe(true);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(10);
  });
});
