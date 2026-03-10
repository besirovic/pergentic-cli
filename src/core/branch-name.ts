import { createHash } from "node:crypto";
import { slugify } from "./worktree";
import { BRANCH_TEMPLATE_VARS } from "./branch-constants";

export { BRANCH_TEMPLATE_VARS, DEFAULT_BRANCH_TEMPLATE } from "./branch-constants";

const DEFAULT_TYPE_MAP: Record<string, string[]> = {
  feat:     ["feature", "enhancement", "improvement", "story", "user-story"],
  fix:      ["bug", "bugfix", "fix", "defect", "incident", "hotfix", "regression"],
  docs:     ["documentation", "docs"],
  refactor: ["refactor", "refactoring", "cleanup", "tech-debt"],
  test:     ["test", "testing", "tests"],
  perf:     ["performance", "perf"],
  ci:       ["ci", "ci/cd", "pipeline"],
  chore:    ["chore", "maintenance", "dependencies"],
  style:    ["style", "formatting", "lint"],
  build:    ["build"],
};

const TASK_TYPE_FALLBACKS: Record<string, string> = {
  new:       "feat",
  feedback:  "fix",
  retry:     "feat",
  scheduled: "chore",
};

const KNOWN_VARS = new Set<string>(BRANCH_TEMPLATE_VARS);

function stripLabelPrefix(label: string): string {
  return label.replace(/^(?:type|kind|category)[:/]/, "");
}

export function resolveConventionalType(
  labels: string[],
  taskType: string,
  customMap?: Record<string, string[]>,
): string {
  const merged = customMap
    ? { ...DEFAULT_TYPE_MAP, ...customMap }
    : DEFAULT_TYPE_MAP;

  const normalizedLabels = labels.map((l) => stripLabelPrefix(l.toLowerCase()));

  for (const label of normalizedLabels) {
    for (const [conventionalType, keywords] of Object.entries(merged)) {
      if (keywords.includes(label)) return conventionalType;
    }
  }

  return TASK_TYPE_FALLBACKS[taskType] ?? "feat";
}

export interface BranchTemplateVars {
  taskId: string;
  title: string;
  source: string;
  type: string;
  project: string;
  agent: string;
  date: string;
  timestamp: string;
  shortHash: string;
}

export function buildBranchName(template: string, vars: BranchTemplateVars): string {
  const result = template.replace(/\{(\w+)\}/g, (match, varName: string) => {
    if (!KNOWN_VARS.has(varName)) return match;
    if (varName === "title") return slugify(vars.title);
    return vars[varName as keyof BranchTemplateVars];
  });

  const sanitized = result
    .replace(/[\s~^:?*\[\]\\]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/[-]+/g, "-")
    .replace(/[/]+/g, "/")
    .replace(/^[-./]+|[-./]+$/g, "")
    .replace(/\.lock$/, "");

  if (!sanitized) {
    const hash = createHash("md5").update(template + JSON.stringify(vars)).digest("hex").slice(0, 7);
    return `branch-${hash}`;
  }

  return sanitized;
}

export function buildBranchTemplateVars(
  template: string,
  opts: {
    taskId: string;
    title: string;
    source: string;
    taskType: string;
    project: string;
    agent: string;
    labels: string[];
    typeMap?: Record<string, string[]>;
  },
): BranchTemplateVars {
  const vars: BranchTemplateVars = {
    taskId: opts.taskId,
    title: opts.title,
    source: opts.source,
    type: "",
    project: opts.project,
    agent: opts.agent,
    date: "",
    timestamp: "",
    shortHash: "",
  };

  if (template.includes("{type}")) {
    vars.type = resolveConventionalType(opts.labels, opts.taskType, opts.typeMap);
  }
  if (template.includes("{date}")) {
    vars.date = new Date().toISOString().slice(0, 10);
  }
  if (template.includes("{timestamp}")) {
    vars.timestamp = String(Math.floor(Date.now() / 1000));
  }
  if (template.includes("{shortHash}")) {
    vars.shortHash = createHash("md5").update(opts.title).digest("hex").slice(0, 7);
  }

  return vars;
}
