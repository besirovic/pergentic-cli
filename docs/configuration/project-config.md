# Project Configuration

Location: `.pergentic/config.yaml` (in your repository root)

Controls behavior for a single project.

## Repository

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `repo` | string | — | Git remote URL (SSH or HTTPS). Required. |
| `branch` | string | `"main"` | Base branch for creating PRs. |

## Agent

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `agent` | enum | `"claude-code"` | Default coding agent. Options: `claude-code`, `codex`, `aider`, `opencode`. |
| `configuredAgents` | string[] | `[]` | Agents available for this project. |
| `agentLabels` | object | — | Map ticket labels to lists of agent names. Example: `{"backend": ["claude-code"], "frontend": ["aider"]}` |
| `agentTools` | object | — | Map agent names to allowed tool lists. Example: `{"claude-code": ["read", "write"]}` |

## Agent Providers

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `agentProviders` | object | — | Map agent names to API providers. Options per agent: `anthropic`, `openai`, `openrouter`, `env`. |

## Model Routing

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `modelLabels` | object | — | Nested map `{label → {agentName → modelId}}`. Routes ticket labels to specific models per agent. |

## Claude Code Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `claude.instructions` | string | `"CLAUDE.md"` | Instruction file name passed to the Claude Code agent. |
| `claude.maxCostPerTask` | number | — | Maximum cost per task in USD. |
| `claude.allowedTools` | string[] | — | Restrict Claude Code to these tools only. |
| `claude.systemContext` | string | — | Additional system context passed to the agent. |
| `claude.agentTimeout` | number | `3600` | Agent execution timeout in seconds. Minimum: 60. |

## PR Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `pr.titleFormat` | string | `"feat: {taskTitle} [{taskId}]"` | PR title template. Variables: `{taskTitle}`, `{taskId}`. |
| `pr.bodyTemplate` | string | — | Inline PR body template string. |
| `pr.templatePath` | string | — | Path to a PR body template file (relative to repo root). Truncated at 10 KB. |
| `pr.labels` | string[] | `["ai-generated", "needs-review"]` | Labels applied to created PRs. |
| `pr.reviewers` | string[] | — | GitHub usernames to request review from. |

## Branching

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `branching.template` | string | `"{taskId}-{title}"` | Branch name template. Must contain `{taskId}`. |
| `branching.typeMap` | object | — | Map type names to lists of matching labels. Example: `{"fix": ["bug", "hotfix"]}` |

Available template variables: `taskId`, `title`, `source`, `type`, `project`, `agent`, `date`, `timestamp`, `shortHash`.

Branch names are sanitized: max 50 chars for the slug portion, with a 7-char hash suffix appended. Invalid characters are removed, hyphens normalized.

## Linear Integration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `linearTeamId` | string | — | Linear team key (e.g., `ENG`). |
| `linear.triggers.onInProgress` | boolean | `true` | Poll issues with "In Progress" status. |
| `linear.triggers.onInReview` | boolean | `false` | Poll issues with "In Review" status. |
| `linear.updateStatus.afterPR` | string | `"In Review"` | Set issue status after PR is created. |
| `linear.updateStatus.afterMerge` | string | `"Done"` | Set issue status after PR is merged. |

## Feedback (PR Comments)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `feedback.listenTo.issueComments` | boolean | `true` | Process GitHub issue comments. |
| `feedback.listenTo.reviewComments` | boolean | `true` | Process GitHub PR review comments. |
| `feedback.listenTo.reviewRequests` | boolean | `false` | Process review request events. |
| `feedback.ignoreUsers` | string[] | `["pergentic[bot]"]` | Users whose comments are ignored. |
| `feedback.maxRounds` | number | `5` | Maximum feedback iterations per task. |

## Verification

Verification commands run via `sh -c` after the agent completes. On failure, the agent is retried up to `maxRetries` times.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `verification.commands` | string[] | `[]` | Shell commands to run after agent completes. |
| `verification.maxRetries` | number | `3` | How many times to retry the agent on verification failure. Range: 0–20. |
| `verification.commandTimeout` | number | `300` | Timeout per verification command in seconds. Minimum: 10. |

## Agent Retry

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `agentRetry.maxRetries` | number | `0` | Max agent retries on failure. Range: 0–10. |
| `agentRetry.baseDelaySeconds` | number | `30` | Base delay between retries in seconds. Range: 1–300. |

## Prompt Template

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `promptTemplate.path` | string | `"PROMPT.md"` | Path to the prompt template file (relative to `.pergentic/`). |

## Slack

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `slack.channels` | object | — | Map Slack channel IDs to channel names for channel-to-project routing. |

## API Keys

API keys should be stored in `.pergentic/.env`, not in `config.yaml`. The init wizard handles this automatically.

| Field | Type | Description |
|-------|------|-------------|
| `anthropicApiKey` | string | Anthropic API key (prefix: `sk-ant-`). |
| `openaiApiKey` | string | OpenAI API key (prefix: `sk-`). |
| `openrouterApiKey` | string | OpenRouter API key (prefix: `sk-or-v1-`). |
| `githubToken` | string | GitHub token (prefixes: `ghp_`, `gho_`, `ghu_`, `ghs_`, `github_pat_`). |
| `linearApiKey` | string | Linear API key (prefix: `lin_api_`). |
| `slackBotToken` | string | Slack bot token (prefix: `xoxb-`). |
| `slackAppToken` | string | Slack app token (prefix: `xoxp-`). |
| `jiraDomain` | string | Jira instance hostname (e.g., `mycompany.atlassian.net`). Not a full URL. |
| `jiraEmail` | string | Jira account email address. |
| `jiraApiToken` | string | Jira API token. |

## Notifications (Project-Level Override)

Project-level notification config follows the same structure as [global config](./global-config.md#notifications). Project settings override global settings when both are present.

## Example

```yaml
repo: git@github.com:acme/backend.git
branch: main
agent: claude-code

claude:
  agentTimeout: 1800
  maxCostPerTask: 5.00

pr:
  titleFormat: "feat: {taskTitle} [{taskId}]"
  labels: ["ai-generated", "needs-review"]
  reviewers: ["alice", "bob"]

branching:
  template: "{type}/{taskId}-{title}"

linearTeamId: ENG
linear:
  triggers:
    onInProgress: true
  updateStatus:
    afterPR: "In Review"
    afterMerge: "Done"

feedback:
  listenTo:
    issueComments: true
    reviewComments: true
  maxRounds: 3

verification:
  commands:
    - "npm test"
    - "npm run lint"
  maxRetries: 2
  commandTimeout: 120
```
