export interface Task {
  id: string;
  project: string;
  priority: number; // 1=feedback (highest), 2=new task, 3=retry
  type: "new" | "feedback" | "retry";
  payload: TaskPayload;
  createdAt: number;
}

export interface TaskPayload {
  taskId: string;
  title: string;
  description: string;
  source: "linear" | "github" | "slack";
  branch?: string;
  prNumber?: number;
  comment?: string;
  metadata?: Record<string, unknown>;
  labels?: string[];
  targetAgents?: string[];
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
    return this.tasks.shift();
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
