export const TaskPriority = {
  FEEDBACK: 1,
  NEW: 2,
  RETRY: 3,
  SCHEDULED: 4,
} as const;

export type TaskPriority = (typeof TaskPriority)[keyof typeof TaskPriority];

export interface Task {
  id: string;
  project: string;
  priority: TaskPriority;
  type: "new" | "feedback" | "retry" | "scheduled";
  payload: TaskPayload;
  createdAt: number;
}

interface BasePayload {
  taskId: string;
  title: string;
  description: string;
  source: "linear" | "github" | "jira" | "slack" | "schedule";
  metadata?: Record<string, unknown>;
  labels?: string[];
  targetAgents?: string[];
  targetModel?: string;
  targetModelLabel?: string;
}

export interface NewTaskPayload extends BasePayload {
  branch?: string;
}

export interface FeedbackPayload extends BasePayload {
  prNumber?: number;
  comment?: string;
}

export interface ScheduledPayload extends BasePayload {
  scheduleId?: string;
  scheduledCommand?: string;
  schedulePrBehavior?: "new" | "update";
  schedulePrBranch?: string | null;
  scheduleTimeout?: number;
  branch?: string;
}

export interface RetryPayload extends BasePayload {
  branch?: string;
}

export type TaskPayload = NewTaskPayload | FeedbackPayload | ScheduledPayload | RetryPayload;

const MAX_FAILED_ENTRIES = 10_000;

export class TaskQueue {
  private tasks: Task[] = [];
  private seen = new Set<string>();
  private failed = new Set<string>();
  private index = new Map<string, number>();

  add(task: Task): boolean {
    if (this.seen.has(task.id)) return false;
    if (this.failed.has(task.id)) return false;
    this.seen.add(task.id);

    // Binary search for insertion point (sorted by priority ascending)
    let lo = 0, hi = this.tasks.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.tasks[mid].priority <= task.priority) lo = mid + 1;
      else hi = mid;
    }
    this.tasks.splice(lo, 0, task);

    // Update indices from insertion point onward
    for (let i = lo; i < this.tasks.length; i++) {
      this.index.set(this.tasks[i].id, i);
    }
    return true;
  }

  next(): Task | undefined {
    const task = this.tasks.shift();
    if (task) {
      this.seen.delete(task.id);
      this.index.delete(task.id);
      // Decrement all remaining indices
      for (let i = 0; i < this.tasks.length; i++) {
        this.index.set(this.tasks[i].id, i);
      }
    }
    return task;
  }

  markFailed(id: string): void {
    if (this.failed.size >= MAX_FAILED_ENTRIES) {
      const oldest = this.failed.values().next().value;
      if (oldest !== undefined) this.failed.delete(oldest);
    }
    this.failed.add(id);
  }

  isKnownFailed(id: string): boolean {
    return this.failed.has(id);
  }

  peek(): Task | undefined {
    return this.tasks[0];
  }

  remove(id: string): boolean {
    const idx = this.index.get(id);
    if (idx === undefined) return false;
    this.tasks.splice(idx, 1);
    this.seen.delete(id);
    this.index.delete(id);
    // Update indices from removal point onward
    for (let i = idx; i < this.tasks.length; i++) {
      this.index.set(this.tasks[i].id, i);
    }
    return true;
  }

  has(id: string): boolean {
    return this.seen.has(id);
  }

  hasScheduleId(scheduleId: string): boolean {
    return this.tasks.some(
      (t) => t.type === "scheduled" && (t.payload as ScheduledPayload).scheduleId === scheduleId,
    );
  }

  get length(): number {
    return this.tasks.length;
  }

  active(): Task[] {
    return [...this.tasks];
  }

  clear(): void {
    this.tasks = [];
    this.seen.clear();
    this.index.clear();
  }
}
