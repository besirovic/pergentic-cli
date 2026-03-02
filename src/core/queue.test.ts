import { describe, it, expect } from "vitest";
import { TaskQueue, type Task } from "./queue";

function makeTask(id: string, priority: number, type: "new" | "feedback" | "retry" = "new"): Task {
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

describe("TaskQueue", () => {
  it("adds and retrieves tasks", () => {
    const q = new TaskQueue();
    q.add(makeTask("a", 2));
    expect(q.length).toBe(1);
    const task = q.next();
    expect(task?.id).toBe("a");
    expect(q.length).toBe(0);
  });

  it("sorts by priority (lower = higher priority)", () => {
    const q = new TaskQueue();
    q.add(makeTask("low", 3));
    q.add(makeTask("high", 1));
    q.add(makeTask("mid", 2));

    expect(q.next()?.id).toBe("high");
    expect(q.next()?.id).toBe("mid");
    expect(q.next()?.id).toBe("low");
  });

  it("deduplicates by task ID", () => {
    const q = new TaskQueue();
    expect(q.add(makeTask("a", 2))).toBe(true);
    expect(q.add(makeTask("a", 1))).toBe(false); // duplicate
    expect(q.length).toBe(1);
  });

  it("allows re-adding after task is consumed", () => {
    const q = new TaskQueue();
    q.add(makeTask("a", 2));
    q.next(); // consume it
    expect(q.add(makeTask("a", 2))).toBe(true);
    expect(q.length).toBe(1);
  });

  it("peeks without removing", () => {
    const q = new TaskQueue();
    q.add(makeTask("a", 2));
    expect(q.peek()?.id).toBe("a");
    expect(q.length).toBe(1); // still there
  });

  it("removes by id", () => {
    const q = new TaskQueue();
    q.add(makeTask("a", 2));
    q.add(makeTask("b", 1));
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
    q.add(makeTask("a", 1));
    q.add(makeTask("b", 2));
    q.clear();
    expect(q.length).toBe(0);
    expect(q.has("a")).toBe(false);
  });

  it("lists active tasks", () => {
    const q = new TaskQueue();
    q.add(makeTask("a", 1));
    q.add(makeTask("b", 2));
    const active = q.active();
    expect(active).toHaveLength(2);
    expect(active[0].id).toBe("a");
  });
});
