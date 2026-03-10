import { z } from "zod";
import { Cron } from "croner";
import { BRANCH_TEMPLATE_VARS } from "../core/branch-constants";

const DEFAULT_STATUS_PORT = 7890;
const DEFAULT_POLL_INTERVAL_SECONDS = 30;
const DEFAULT_AGENT_TIMEOUT_SECONDS = 3600;
const DEFAULT_AGENT_RETRY_DELAY_SECONDS = 30;

const NotificationChannelSchema = z.object({
	webhook: z.string().url(),
	on: z.object({
		taskCompleted: z.boolean().default(false),
		taskFailed: z.boolean().default(false),
		prCreated: z.boolean().default(false),
	}),
});

const DesktopNotificationSchema = z.object({
	on: z.object({
		taskCompleted: z.boolean().default(false),
		taskFailed: z.boolean().default(false),
		prCreated: z.boolean().default(false),
	}),
});

const RemoteSchema = z.object({
	host: z.string(),
	port: z.number().default(DEFAULT_STATUS_PORT),
});

const NotificationsSchema = z.object({
	slack: NotificationChannelSchema.optional(),
	discord: NotificationChannelSchema.optional(),
	desktop: DesktopNotificationSchema.optional(),
});

export type Notifications = z.infer<typeof NotificationsSchema>;

export const AgentName = z.enum(["claude-code", "codex", "aider", "opencode"]);

export const ApiProvider = z.enum([
	"anthropic",
	"openai",
	"openrouter",
	"env",
]);

export const GlobalConfigSchema = z.object({
	pollInterval: z.number().min(5).default(DEFAULT_POLL_INTERVAL_SECONDS),
	maxConcurrent: z.number().min(1).default(2),
	statusPort: z.number().default(DEFAULT_STATUS_PORT),
	notifications: NotificationsSchema.optional(),
	remotes: z.record(z.string(), RemoteSchema).optional(),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

const ClaudeOptionsSchema = z.object({
	instructions: z.string().default("CLAUDE.md"),
	maxCostPerTask: z.number().optional(),
	allowedTools: z.array(z.string()).optional(),
	systemContext: z.string().optional(),
	agentTimeout: z.number().min(60).default(DEFAULT_AGENT_TIMEOUT_SECONDS).optional(),
});

const PRConfigSchema = z.object({
	titleFormat: z.string().default("feat: {taskTitle} [{taskId}]"),
	bodyTemplate: z.string().optional(),
	templatePath: z.string().optional(),
	labels: z.array(z.string()).default(["ai-generated", "needs-review"]),
	reviewers: z.array(z.string()).optional(),
});

const BranchConfigSchema = z.object({
	template: z.string().default("{taskId}-{title}"),
	typeMap: z.record(z.string(), z.array(z.string())).optional(),
}).default({ template: "{taskId}-{title}" }).superRefine((val, ctx) => {
	if (!val.template.includes("{taskId}")) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: "Branch template must contain {taskId} to ensure unique branch names",
			path: ["template"],
		});
	}

	const usedVars = [...val.template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
	const unknown = usedVars.filter((v) => !BRANCH_TEMPLATE_VARS.includes(v as typeof BRANCH_TEMPLATE_VARS[number]));
	if (unknown.length > 0) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: `Unknown branch template variables: ${unknown.join(", ")}. Valid: ${BRANCH_TEMPLATE_VARS.join(", ")}`,
			path: ["template"],
		});
	}
});

const LinearConfigSchema = z.object({
	triggers: z
		.object({
			onInProgress: z.boolean().default(true),
			onInReview: z.boolean().default(false),
		})
		.optional(),
	updateStatus: z
		.object({
			afterPR: z.string().default("In Review"),
			afterMerge: z.string().default("Done"),
		})
		.optional(),
});

const FeedbackConfigSchema = z.object({
	listenTo: z
		.object({
			issueComments: z.boolean().default(true),
			reviewComments: z.boolean().default(true),
			reviewRequests: z.boolean().default(false),
		})
		.optional(),
	ignoreUsers: z.array(z.string()).default(["pergentic[bot]"]),
	maxRounds: z.number().default(5),
});

const VerificationConfigSchema = z.object({
	commands: z.array(z.string()).default([]),
	maxRetries: z.number().min(0).max(20).default(3),
});

const AgentRetryConfigSchema = z.object({
	maxRetries: z.number().min(0).max(10).default(0),
	baseDelaySeconds: z.number().min(1).max(300).default(DEFAULT_AGENT_RETRY_DELAY_SECONDS),
});

const SlackProjectConfigSchema = z.object({
	channels: z.record(z.string(), z.string()).optional(),
});

const PromptTemplateConfigSchema = z.object({
	path: z.string().default("PROMPT.md"),
});

export const TaskSource = z.enum(["linear", "github", "jira", "slack", "schedule"]);
export type TaskSource = z.infer<typeof TaskSource>;

export const ScheduleType = z.enum(["prompt", "command"]);
export const PRBehavior = z.enum(["new", "update"]);

export const ScheduleEntrySchema = z.object({
	id: z.string(),
	name: z.string(),
	cron: z.string().refine((val) => {
		try { new Cron(val); return true; } catch { return false; }
	}, "Invalid cron expression"),
	type: ScheduleType,
	prompt: z.string().optional(),
	agent: AgentName.optional(),
	command: z.string().optional(),
	branch: z.string().default("main"),
	prBehavior: PRBehavior.default("new"),
	prBranch: z.string().nullable().default(null),
	enabled: z.boolean().default(true),
	lastRun: z.string().nullable().default(null),
	createdAt: z.string(),
}).superRefine((val, ctx) => {
	if (val.type === "prompt" && !val.prompt)
		ctx.addIssue({ code: z.ZodIssueCode.custom, message: "prompt path required", path: ["prompt"] });
	if (val.type === "command" && !val.command)
		ctx.addIssue({ code: z.ZodIssueCode.custom, message: "command required", path: ["command"] });
	if (val.prBehavior === "update" && !val.prBranch)
		ctx.addIssue({ code: z.ZodIssueCode.custom, message: "prBranch required for update behavior", path: ["prBranch"] });
});

export const SchedulesConfigSchema = z.object({
	schedules: z.array(ScheduleEntrySchema).default([]),
});

export type ScheduleEntry = z.infer<typeof ScheduleEntrySchema>;
export type SchedulesConfig = z.infer<typeof SchedulesConfigSchema>;

export const ProjectConfigSchema = z.object({
	repo: z.string(),
	branch: z.string().default("main"),
	agent: AgentName.default("claude-code"),
	configuredAgents: z.array(AgentName).default([]),
	anthropicApiKey: z.string().optional(),
	openaiApiKey: z.string().optional(),
	openrouterApiKey: z.string().optional(),
	agentProviders: z.record(z.string(), ApiProvider).optional(),
	githubToken: z.string().optional(),
	linearApiKey: z.string().optional(),
	slackBotToken: z.string().optional(),
	slackAppToken: z.string().optional(),
	jiraDomain: z.string().optional(),
	jiraEmail: z.string().email().optional(),
	jiraApiToken: z.string().optional(),
	linearTeamId: z.string().optional(),
	agentTools: z.record(z.string(), z.array(z.string())).optional(),
	agentLabels: z.record(z.string(), z.array(z.string())).optional(),
	modelLabels: z.record(z.string(), z.record(z.string(), z.string())).optional(),
	claude: ClaudeOptionsSchema.optional(),
	pr: PRConfigSchema.optional(),
	linear: LinearConfigSchema.optional(),
	feedback: FeedbackConfigSchema.optional(),
	verification: VerificationConfigSchema.optional(),
	agentRetry: AgentRetryConfigSchema.optional(),
	branching: BranchConfigSchema.optional(),
	promptTemplate: PromptTemplateConfigSchema.optional(),
	slack: SlackProjectConfigSchema.optional(),
	notifications: NotificationsSchema.optional(),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type BranchConfig = z.infer<typeof BranchConfigSchema>;

const ProjectEntrySchema = z.object({
	path: z.string(),
});

export const ProjectsRegistrySchema = z.object({
	projects: z.array(ProjectEntrySchema).default([]),
});

export type ProjectsRegistry = z.infer<typeof ProjectsRegistrySchema>;
export type ProjectEntry = z.infer<typeof ProjectEntrySchema>;
