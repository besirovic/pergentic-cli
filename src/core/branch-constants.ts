export const BRANCH_TEMPLATE_VARS = [
  "taskId", "title", "source", "type", "project",
  "agent", "date", "timestamp", "shortHash",
] as const;

export const DEFAULT_BRANCH_TEMPLATE = "{taskId}-{title}";
