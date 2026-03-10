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
  branch?: string;
}

export interface RetryPayload extends BasePayload {
  branch?: string;
}

export type TaskPayload = NewTaskPayload | FeedbackPayload | ScheduledPayload | RetryPayload;

/**
 * Type guard for FeedbackPayload. Use after checking `task.type === "feedback"` —
 * these guards narrow the TypeScript type but should not be the primary discriminator.
 */
export function isFeedbackPayload(payload: TaskPayload): payload is FeedbackPayload {
  return "prNumber" in payload;
}

/**
 * Type guard for ScheduledPayload. Use after checking `task.type === "scheduled"` —
 * these guards narrow the TypeScript type but should not be the primary discriminator.
 */
export function isScheduledPayload(payload: TaskPayload): payload is ScheduledPayload {
  return "scheduleId" in payload || "scheduledCommand" in payload || "schedulePrBehavior" in payload;
}

const MAX_FAILED_ENTRIES = 10_000;

export class TaskQueue {
  private tasks: Task[] = [];
  private seen = new Set<string>();
  private failed = new Set<string>();

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
    return true;
  }

  next(): Task | undefined {
    const task = this.tasks.shift();
    if (task) this.seen.delete(task.id);
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
    const idx = this.tasks.findIndex((t) => t.id === id);
    if (idx === -1) return false;
    this.tasks.splice(idx, 1);
    this.seen.delete(id);
    return true;
  }

  has(id: string): boolean {
    return this.seen.has(id);
  }

  hasScheduleId(scheduleId: string): boolean {
    return this.tasks.some(
      (t) => t.type === "scheduled" && "scheduleId" in t.payload && t.payload.scheduleId === scheduleId,
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
  }
}
