import { z } from "zod";

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
	port: z.number().default(7890),
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
	pollInterval: z.number().min(5).default(30),
	maxConcurrent: z.number().min(1).default(2),
	statusPort: z.number().default(7890),
	notifications: NotificationsSchema.optional(),
	remotes: z.record(z.string(), RemoteSchema).optional(),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

const ClaudeOptionsSchema = z.object({
	instructions: z.string().default("CLAUDE.md"),
	maxCostPerTask: z.number().optional(),
	allowedTools: z.array(z.string()).optional(),
	systemContext: z.string().optional(),
});

const PRConfigSchema = z.object({
	titleFormat: z.string().default("feat: {taskTitle} [{taskId}]"),
	bodyTemplate: z.string().optional(),
	labels: z.array(z.string()).default(["ai-generated", "needs-review"]),
	reviewers: z.array(z.string()).optional(),
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

const SlackProjectConfigSchema = z.object({
	channels: z.record(z.string(), z.string()).optional(),
});

export const ProjectConfigSchema = z.object({
	repo: z.string(),
	branch: z.string().default("main"),
	agent: AgentName.default("claude-code"),
	configuredAgents: z.array(AgentName).default([]),
	anthropicApiKey: z.string().optional(),
	openaiApiKey: z.string().optional(),
	openrouterApiKey: z.string().optional(),
	agentProviders: z.record(AgentName, ApiProvider).optional(),
	githubToken: z.string().optional(),
	linearApiKey: z.string().optional(),
	slackBotToken: z.string().optional(),
	slackAppToken: z.string().optional(),
	jiraDomain: z.string().optional(),
	jiraEmail: z.string().email().optional(),
	jiraApiToken: z.string().optional(),
	linearTeamId: z.string().optional(),
	agentTools: z.record(AgentName, z.array(z.string())).optional(),
	agentLabels: z.record(AgentName, z.array(z.string())).optional(),
	modelLabels: z.record(AgentName, z.record(z.string(), z.string())).optional(),
	claude: ClaudeOptionsSchema.optional(),
	pr: PRConfigSchema.optional(),
	linear: LinearConfigSchema.optional(),
	feedback: FeedbackConfigSchema.optional(),
	verification: VerificationConfigSchema.optional(),
	slack: SlackProjectConfigSchema.optional(),
	notifications: NotificationsSchema.optional(),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

const ProjectEntrySchema = z.object({
	path: z.string(),
});

export const ProjectsRegistrySchema = z.object({
	projects: z.array(ProjectEntrySchema).default([]),
});

export type ProjectsRegistry = z.infer<typeof ProjectsRegistrySchema>;
export type ProjectEntry = z.infer<typeof ProjectEntrySchema>;
