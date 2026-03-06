export interface IncomingTask {
  id: string;
  title: string;
  description: string;
  source: "linear" | "github" | "slack";
  priority: number;
  type: "new" | "feedback";
  metadata: Record<string, unknown>;
  labels: string[];
}

export interface TaskResult {
  taskId: string;
  status: "completed" | "failed";
  prUrl?: string;
  duration: number; // seconds
  estimatedCost: number; // dollars
  error?: string;
}

export interface ProjectContext {
  name: string;
  path: string;
  repo: string;
  branch: string;
  agent: string;
  linearTeamId?: string;
}

export interface TaskProvider {
  name: string;
  poll(project: ProjectContext): Promise<IncomingTask[]>;
  onComplete(
    project: ProjectContext,
    taskId: string,
    result: TaskResult,
  ): Promise<void>;
}
