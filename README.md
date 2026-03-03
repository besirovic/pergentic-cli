# Pergentic

Turn project management tickets into pull requests autonomously.

Pergentic is a CLI daemon that watches your issue tracker (Linear, GitHub Issues, Jira), spawns a coding agent to implement each task in an isolated git worktree, opens a PR, and iterates on reviewer feedback — all without manual intervention.

## Prerequisites

- Node.js 20+
- Git
- A coding agent CLI installed: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Aider](https://aider.chat), [Codex](https://github.com/openai/codex), or [OpenCode](https://github.com/opencode-ai/opencode)
- API keys for your agent provider (Anthropic, OpenAI, or OpenRouter)
- A GitHub token for PR creation
- An issue tracker API key (Linear, GitHub, or Jira)

## Installation

```bash
npm install
npm run build
```

## Quick Start

### 1. Initialize a project

```bash
pergentic init /path/to/your/repo
```

The interactive wizard walks you through:

- Selecting a coding agent
- Entering API keys
- Connecting your issue tracker (Linear, GitHub Issues, Jira)
- Configuring PR templates, labels, and reviewers

### 2. Start the daemon

```bash
pergentic start
```

The daemon polls your issue tracker every 30 seconds (configurable). When a ticket moves to "In Progress", Pergentic:

1. Creates a git worktree for the task
2. Spawns your configured coding agent with the task description
3. Commits and pushes the changes
4. Opens a pull request
5. Updates the ticket status to "In Review"

### 3. Feedback loop

When a reviewer leaves a comment on a Pergentic-managed PR, the daemon picks it up automatically, re-runs the agent with the full conversation history, and pushes an update.

## CLI Commands

### Daemon

| Command               | Description                        |
| --------------------- | ---------------------------------- |
| `pergentic start`     | Start the daemon in the background |
| `pergentic stop`      | Stop the daemon gracefully         |
| `pergentic restart`   | Restart the daemon                 |
| `pergentic status`    | Show daemon status                 |

### Projects

| Command                    | Description                           |
| -------------------------- | ------------------------------------- |
| `pergentic init [path]`   | Interactive project setup             |
| `pergentic add [path]`    | Register an existing project          |
| `pergentic remove [path]` | Unregister a project                  |
| `pergentic list`          | List all registered projects          |

### Tasks & Logs

| Command                          | Description                    |
| -------------------------------- | ------------------------------ |
| `pergentic logs [-f] [-n 100]`  | Tail daemon logs               |
| `pergentic retry <taskId>`      | Retry a failed task            |
| `pergentic cancel <taskId>`     | Cancel a running task          |
| `pergentic service install`     | Generate system service config |

Use `--verbose` with any command for detailed output.

## Configuration

Pergentic uses YAML config files:

- **Global config**: `~/.pergentic/config.yaml`
- **Project config**: `.pergentic/config.yaml` (inside your repo)

### Example project config

```yaml
repo: https://github.com/owner/repo.git
branch: main
agent: claude-code

githubToken: ghp_...
linearApiKey: lin_api_...
linearTeamId: PROJ

pr:
  titleFormat: "feat: {taskTitle} [{taskId}]"
  labels: [ai-generated, needs-review]
  reviewers: [your-username]

feedback:
  listenTo:
    issueComments: true
    reviewComments: true
  maxRounds: 5
```

### Global config options

```yaml
pollInterval: 30      # seconds between polls (min 5)
maxConcurrent: 2      # max parallel tasks

notifications:
  slack:
    webhook: https://hooks.slack.com/...
    on:
      taskCompleted: true
      taskFailed: true
      prCreated: true
```

## Supported Agents

| Agent        | Providers                          |
| ------------ | ---------------------------------- |
| Claude Code  | Anthropic                          |
| Aider        | Anthropic, OpenAI, OpenRouter      |
| Codex        | OpenAI                             |
| OpenCode     | Anthropic, OpenAI, OpenRouter      |

## Supported Integrations

| Integration | Use                              |
| ----------- | -------------------------------- |
| Linear      | Issue tracking, status updates   |
| GitHub      | PRs, feedback detection          |
| Jira        | Issue tracking                   |
| Slack       | Notifications, task triggers     |

## License

MIT
