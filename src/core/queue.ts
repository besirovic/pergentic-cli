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
  source: "linear" | "github" | "slack" | "schedule";
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

export function isFeedbackPayload(payload: TaskPayload): payload is FeedbackPayload {
  return "comment" in payload || "prNumber" in payload;
}

export function isScheduledPayload(payload: TaskPayload): payload is ScheduledPayload {
  return "scheduleId" in payload || "scheduledCommand" in payload || "schedulePrBehavior" in payload;
}

export class TaskQueue {
  private tasks: Task[] = [];
  private seen = new Set<string>();
  private failed = new Set<string>();

  add(task: Task): boolean {
    if (this.seen.has(task.id)) return false;
    if (this.failed.has(task.id)) return false;
    this.seen.add(task.id);
    this.tasks.push(task);
    this.tasks.sort((a, b) => a.priority - b.priority);
    return true;
  }

  next(): Task | undefined {
    const task = this.tasks.shift();
    if (task) this.seen.delete(task.id);
    return task;
  }

  markFailed(id: string): void {
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
