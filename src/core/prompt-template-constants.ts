export const PROMPT_TEMPLATE_VARS = [
	// Ticket fields
	"title",
	"description",
	"taskId",
	"source",
	"labels",
	"priority",

	// Metadata (provider-specific, empty string when not available)
	"url",
	"identifier",
	"issueNumber",
	"owner",
	"repo",

	// Project context
	"project",
	"branch",
	"agent",

	// Computed
	"date",
	"timestamp",
] as const;

export type PromptTemplateVar = (typeof PROMPT_TEMPLATE_VARS)[number];

export const DEFAULT_PROMPT_TEMPLATE = `# {title}

{description}

## Context

- **Task ID:** {taskId}
- **Source:** {source}
- **Labels:** {labels}
- **Ticket URL:** {url}

## Instructions

Implement the changes described above. Follow existing code conventions and patterns in this repository.
`;
