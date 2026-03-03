# Pergentic

A CLI tool that turns project management tickets into pull requests autonomously. Pergentic monitors your task trackers (Linear, GitHub Issues, Slack), runs coding agents on tasks marked "In Progress", creates pull requests, and handles feedback loops — all in the background.

## Motivation

Developers spend significant time on the cycle of picking up a ticket, creating a branch, writing code, and opening a PR. Pergentic automates this loop by bridging project management tools with AI coding agents. When a task is moved to "In Progress", Pergentic picks it up, spins up an isolated git worktree, runs the configured coding agent, and opens a PR. If a reviewer leaves feedback, Pergentic re-runs the agent with the full context of prior rounds — no manual intervention needed.

## How It Works

```
Ticket → "In Progress"
        │
        ▼
  Daemon polls task source (every 30s)
        │
        ▼
  Creates isolated git worktree
        │
        ▼
  Spawns coding agent (Claude Code / Codex / Aider / OpenCode)
        │
        ▼
  Agent implements the task
        │
        ▼
  Commits, pushes, creates PR
        │
        ▼
  Updates ticket status → Sends notification
        │
        ▼
  Listens for PR review comments ──► Re-runs agent with feedback
```

1. You move a ticket to "In Progress" in Linear, GitHub, or Slack
2. Pergentic's daemon detects the change (polls every 30s)
3. A git worktree is created for isolated work
4. The configured coding agent (Claude Code, Codex, Aider, or OpenCode) runs against the task
5. Changes are committed, pushed, and a PR is created
6. The task status updates automatically (e.g., "In Review")
7. If a reviewer comments on the PR, Pergentic re-runs the agent with feedback context
8. Notifications are sent via Slack or Discord

## Requirements

- **Node.js** >= 20
- **Git** (for worktree operations)
- At least one coding agent CLI installed: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://github.com/openai/codex), [Aider](https://aider.chat), or [OpenCode](https://github.com/opencode-ai/opencode)
- API keys for your chosen provider(s) and task tracker(s)

## Installation

```bash
npm install -g pergentic
```

Or with Yarn:

```bash
yarn global add pergentic
```

## Quick Start

### 1. Initialize a project

```bash
pergentic init /path/to/my-project
```

The interactive wizard walks you through:
- Repository URL and default branch
- API keys for services (Linear, GitHub, Slack)
- Coding agent selection (claude-code, aider, codex, opencode)
- Poll interval and concurrency settings

This creates:
- `~/.pergentic/config.yaml` — global daemon settings
- `<project>/.pergentic/config.yaml` — project-specific settings

### 2. Start the daemon

```bash
pergentic start
```

### 3. Move a ticket to "In Progress"

Pergentic picks it up and opens a PR automatically.

### 4. Monitor progress

```bash
pergentic status      # Quick status check
pergentic dashboard   # Full TUI dashboard
pergentic logs -f     # Follow daemon logs
```

## Commands

### Setup & Project Management

| Command | Description |
|---|---|
| `pergentic init [path]` | Interactive setup wizard for a new project |
| `pergentic add [path]` | Register an existing project directory |
| `pergentic remove [path]` | Unregister a project |
| `pergentic list` | Show all registered projects |

### Daemon Control

| Command | Description |
|---|---|
| `pergentic start` | Start the daemon in the background |
| `pergentic stop` | Stop the daemon gracefully (5-min timeout for active tasks) |
| `pergentic restart` | Stop and restart the daemon |
| `pergentic status` | Show daemon status, uptime, and daily stats |

### Monitoring

| Command | Description |
|---|---|
| `pergentic dashboard` | Full terminal UI monitoring dashboard |
| `pergentic logs` | Tail daemon logs (default: last 50 lines) |
| `pergentic logs -f` | Follow log output in real-time |
| `pergentic logs --project <name>` | Filter logs by project |
| `pergentic logs -n <count>` | Show specific number of lines |

### Task Management

| Command | Description |
|---|---|
| `pergentic retry <taskId>` | Retry a failed task |
| `pergentic cancel <taskId>` | Cancel a running task |

### Service Installation

| Command | Description |
|---|---|
| `pergentic service install` | Generate a systemd (Linux) or launchd (macOS) service config |

### Global Options

| Option | Description |
|---|---|
| `--verbose` | Enable verbose logging |
| `--help` | Show help |
| `--version` | Show version |

## Configuration

### Global Configuration (`~/.pergentic/config.yaml`)

Controls daemon-wide behavior:

```yaml
pollInterval: 30          # Seconds between task polls (min: 5)
maxConcurrent: 2          # Max concurrent task executions (min: 1)
statusPort: 7890          # HTTP status endpoint port

notifications:
  slack:
    webhook: https://hooks.slack.com/services/...
    on:
      taskCompleted: true
      taskFailed: true
      prCreated: true
  discord:
    webhook: https://discord.com/api/webhooks/...
    on:
      taskFailed: true
      prCreated: true

remotes:
  prod:
    host: user@prod.example.com
    port: 7890
```

### Project Configuration (`<project>/.pergentic/config.yaml`)

Per-project settings:

```yaml
repo: git@github.com:owner/repo.git
branch: main

# Agent selection
agent: claude-code
configuredAgents:
  - claude-code
  - aider
agentTools:
  claude-code:
    - Edit
    - Write
    - Read
    - Bash
    - Glob
    - Grep

# API keys
anthropicApiKey: sk-ant-...
githubToken: ghp_...
linearApiKey: lin_api_...

# Claude Code options
claude:
  instructions: CLAUDE.md
  maxCostPerTask: 5.00

# PR template
pr:
  titleFormat: "feat: {taskTitle} [{taskId}]"
  labels:
    - ai-generated
    - needs-review
  reviewers:
    - teammate1

# Linear integration
linear:
  triggers:
    onInProgress: true
  updateStatus:
    afterPR: "In Review"
    afterMerge: "Done"

# Feedback loop
feedback:
  listenTo:
    issueComments: true
    reviewComments: true
  ignoreUsers:
    - pergentic[bot]
  maxRounds: 5
```

## Environment Variables

API keys can also be provided via environment variables instead of (or in addition to) config files:

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude Code |
| `OPENAI_API_KEY` | OpenAI API key for Codex |
| `OPENROUTER_API_KEY` | OpenRouter API key (multi-provider) |
| `GITHUB_TOKEN` | GitHub personal access token |
| `LINEAR_API_KEY` | Linear API key |
| `PERGENTIC_HOME` | Override default data directory (`~/.pergentic`) |

These can also be placed in `~/.pergentic/.env`. Project-level API keys in `.pergentic/config.yaml` take precedence over global keys and environment variables.

## Supported Agents

| Agent | Provider | Command |
|---|---|---|
| `claude-code` | Anthropic | `claude -p "{prompt}" --allowedTools Edit,Read,Write,Bash` |
| `codex` | OpenAI | `codex "{prompt}"` |
| `aider` | OpenAI, Anthropic, OpenRouter | `aider --message "{prompt}" --yes` |
| `opencode` | OpenAI, Anthropic | `opencode run "{prompt}" --tool edit --tool bash` |

Each agent is a thin adapter that builds CLI arguments. Tools and cost limits are configurable per agent via the project config (`agentTools`, `claude.maxCostPerTask`).

## Supported Task Providers

| Provider | Trigger | Features |
|---|---|---|
| **Linear** | Task moved to "In Progress" | Auto status updates, team filtering via `linearTeamId` |
| **GitHub** | Issue assigned | PR creation, review comment detection for feedback |
| **Slack** | `@pergentic` mention | Channel-to-project mapping, thread replies |

## Feedback Loop

Pergentic tracks feedback history in each worktree (`.claude-history.json`). When a reviewer comments on a PR:

1. The daemon detects the new comment
2. Loads the full feedback history for that task
3. Builds a prompt with the original task + all prior feedback rounds
4. Re-runs the agent in the same worktree
5. Pushes updated changes to the PR

This continues for up to `feedback.maxRounds` iterations (default: 5).

## Notifications

Pergentic can notify your team via Slack or Discord when tasks complete, fail, or produce PRs. Configure webhooks in the global config:

```yaml
# ~/.pergentic/config.yaml
notifications:
  slack:
    webhook: https://hooks.slack.com/services/T00/B00/xxx
    on:
      taskCompleted: true
      taskFailed: true
      prCreated: true
  discord:
    webhook: https://discord.com/api/webhooks/xxx/yyy
    on:
      taskFailed: true
```

## Cost Tracking

Pergentic tracks execution costs per task and aggregates daily statistics in `~/.pergentic/stats.json`. View summaries with `pergentic status`:

```
● Pergentic: running · Uptime 2h 34m · 1 projects · 0 active tasks
  Today: 5 tasks · 3 PRs · 0 failed · $2.45 cost
```

Set a per-task spending limit to prevent runaway costs:

```yaml
# .pergentic/config.yaml
claude:
  maxCostPerTask: 5.00   # Kill agent if cost exceeds $5
```

## Remote Monitoring

Monitor a remote Pergentic instance over SSH:

```yaml
# In ~/.pergentic/config.yaml
remotes:
  prod:
    host: user@prod.example.com
    port: 7890
```

```bash
pergentic status --remote prod
```

## Examples

### Automate a Linear workflow

```bash
# Initialize project with Linear integration
pergentic init ./my-app

# Configure Linear triggers in .pergentic/config.yaml:
#   linear:
#     triggers:
#       onInProgress: true
#     updateStatus:
#       afterPR: "In Review"
#       afterMerge: "Done"

# Start the daemon
pergentic start

# Move a Linear ticket to "In Progress" — Pergentic creates a PR automatically
```

### Run as a system service

```bash
# Generate and install a launchd (macOS) or systemd (Linux) service
pergentic service install

# Pergentic will now start automatically on boot
```

### Monitor and debug

```bash
# Check current status with daily stats
pergentic status
# ● Pergentic: running · Uptime 2h 34m · 1 projects · 0 active tasks
#   Today: 5 tasks · 3 PRs · 0 failed · $2.45 cost

# Follow logs for a specific project
pergentic logs -f --project my-app

# Open the full TUI dashboard
pergentic dashboard
```

### Multi-project setup

Register several repositories and manage them all from a single daemon:

```bash
pergentic add ~/projects/api-service
pergentic add ~/projects/web-frontend
pergentic add ~/projects/mobile-app

pergentic list         # See all registered projects
pergentic start        # One daemon handles everything
pergentic dashboard    # Monitor all projects in one view
```

### Slack-driven workflow

Bind Slack channels to projects so team members can request work via chat:

```yaml
# .pergentic/config.yaml
slack:
  channels:
    "#backend-dev": api-service
    "#frontend-dev": web-frontend
```

Then in Slack:

```
@pergentic fix the login page redirect bug
@pergentic in api-service add rate limiting to the /users endpoint
```

Pergentic responds in the thread with progress updates and the PR link.

### Retry a failed task

```bash
# List recent activity to find the task ID
pergentic logs -n 20

# Retry the failed task
pergentic retry PER-42
```

## File System Layout

Pergentic stores its data under `~/.pergentic/`:

```
~/.pergentic/
├── config.yaml          # Global configuration (API keys, polling, notifications)
├── projects.yaml        # List of registered projects
├── daemon.pid           # PID of the running daemon
├── daemon.log           # Daemon logs (JSON/Pino format)
├── state.json           # Live daemon state (status, uptime, active tasks)
├── stats.json           # Cost tracking and daily statistics
└── workspaces/
    └── <project>/
        ├── repo/            # Cached repository clone
        └── worktrees/
            ├── TASK-123/    # Isolated worktree for task TASK-123
            └── TASK-456/    # Isolated worktree for task TASK-456
```

Each project also has a `.pergentic/config.yaml` in its root directory for project-specific settings.

## Tech Stack

| Component | Technology |
|---|---|
| Language | TypeScript (ES2022, ESM) |
| CLI framework | Commander.js |
| Configuration | YAML + Zod validation |
| TUI dashboard | Ink (React for the terminal) |
| Interactive prompts | Inquirer |
| Git operations | simple-git |
| Logging | Pino |
| Bundler | tsup |
| Tests | Vitest |

## Development

### Setup

```bash
git clone git@github.com:besirovic/pergentic-cli.git
cd pergentic-cli
npm install
```

### Scripts

| Script | Description |
|---|---|
| `npm run dev` | Run in development mode (tsx) |
| `npm run build` | Build to `dist/` (tsup, ESM) |
| `npm run test` | Run tests (vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Type-check with `tsc --noEmit` |
| `npm run clean` | Remove `dist/` directory |

### Project Structure

```
src/
├── bin/pergentic.ts       # CLI entry point
├── cli.ts                 # Command definitions (Commander.js)
├── daemon.ts              # Background daemon process
├── agents/                # Coding agent integrations
├── commands/              # CLI command implementations
├── config/                # Configuration loading & validation (Zod)
├── core/                  # Task runner, queue, poller, worktree, git
├── providers/             # Linear, GitHub, Slack integrations
└── utils/                 # Logger, health checks, process management
```

### Running locally

```bash
# Build and link for local testing
npm run build
npm link
pergentic --version
```

## License

See [LICENSE](./LICENSE) for details.
