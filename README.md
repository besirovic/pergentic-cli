# Pergentic

Turn project management tickets into pull requests — autonomously.

Pergentic is a daemon-based CLI tool that polls task trackers (Linear, GitHub Issues, Slack) for tickets marked "In Progress", dispatches AI coding agents (Claude Code, Codex, Aider, OpenCode) to implement them, and opens pull requests automatically. When reviewers leave comments, the feedback loop kicks in: the agent reads the comments, revises the code, and force-pushes updates — up to 5 rounds per task.

## Table of Contents

- [Motivation](#motivation)
- [How It Works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Supported Agents](#supported-agents)
- [Supported Task Providers](#supported-task-providers)
- [Feedback Loop](#feedback-loop)
- [Notifications](#notifications)
- [Cost Tracking](#cost-tracking)
- [Remote Monitoring](#remote-monitoring)
- [Examples](#examples)
- [File System Layout](#file-system-layout)
- [Tech Stack](#tech-stack)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Design Decisions](#design-decisions)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

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

### From Source

```bash
git clone <repo-url>
cd pergentic-cli
npm install
npm run build
npm link
```

Verify the installation:

```bash
pergentic --version
```

## Quick Start

### 1. Initialize a project

```bash
pergentic init /path/to/my-project
```

The interactive wizard walks you through four steps:

1. **Select agents** — Choose which coding agents to enable (Claude Code, Aider, Codex, OpenCode)
2. **Set default agent** — Pick which agent runs by default
3. **Configure API keys** — Enter API keys per agent/provider (Anthropic, OpenAI, OpenRouter)
4. **Configure tools** — Select which tools each agent can use (Edit, Read, Bash, etc.)

After the wizard, a menu lets you configure integrations:
- **GitHub** — token for PR creation and issue tracking
- **Linear** — API key and team ID for task polling
- **Jira** — domain, email, and API token
- **Slack** — bot and app tokens for chat-driven workflows
- **Project Settings** — repository URL and default branch

This creates:
- `<project>/.pergentic/config.yaml` — project-specific settings (agents, keys, integrations)
- `~/.pergentic/projects.yaml` — registry entry for this project

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
| `pergentic add [path]` | Register an existing project directory (delegates to `init` if no config found) |
| `pergentic remove [path]` | Unregister a project (with confirmation prompt) |
| `pergentic list` | Show all registered projects with daemon status |

### Daemon Control

| Command | Description |
|---|---|
| `pergentic start` | Start the daemon in the background |
| `pergentic stop` | Stop the daemon gracefully (waits up to 5 minutes for active tasks) |
| `pergentic restart` | Stop and restart the daemon |
| `pergentic status` | Show daemon status, uptime, active tasks, and daily stats |
| `pergentic status --remote <name>` | Check status on a remote host via SSH tunnel |

### Monitoring

| Command | Description |
|---|---|
| `pergentic dashboard` | Full terminal UI monitoring dashboard |
| `pergentic logs` | Show daemon logs (default: last 50 lines) |
| `pergentic logs -f` | Follow log output in real-time |
| `pergentic logs --project <name>` | Filter logs by project |
| `pergentic logs -n <count>` | Show specific number of lines |

### Task Management

| Command | Description |
|---|---|
| `pergentic retry <taskId>` | Retry a failed task (re-queued at priority 3) |
| `pergentic cancel <taskId>` | Cancel a running task (sends SIGTERM to agent process) |

### Service Installation

| Command | Description |
|---|---|
| `pergentic service install` | Generate a systemd (Linux) or launchd (macOS) service config for auto-start on boot |

### Global Options

| Option | Description |
|---|---|
| `--verbose` | Enable verbose logging |
| `--help` | Show help |
| `--version` | Show version |

## Architecture

```
┌──────────────┐     poll      ┌──────────────┐    dispatch    ┌──────────────┐
│   Linear /   │ ──────────▶  │    Poller     │ ────────────▶ │  TaskRunner   │
│   GitHub /   │              │  (30s cycle)  │               │              │
│   Slack      │              └──────────────┘               └──────┬───────┘
└──────────────┘                                                     │
                                                                     ▼
                                                          ┌──────────────────┐
                                                          │   Git Worktree   │
                                                          │   + AI Agent     │
                                                          │ (Claude/Codex/…) │
                                                          └────────┬─────────┘
                                                                   │
                                                                   ▼
                                                          ┌──────────────────┐
                                                          │  Commit + Push   │
                                                          │  + Create PR     │
                                                          └────────┬─────────┘
                                                                   │
                                                          ┌────────▼─────────┐
                                                          │  PR Comments?    │
                                                          │  → Feedback Loop │
                                                          │  (up to 5 rounds)│
                                                          └──────────────────┘
```

The daemon runs as a background process with an HTTP status endpoint (default port 7890). Key components:

- **Poller** — checks task sources on a configurable interval (default 30s) and enqueues new work. For each registered project, it instantiates the appropriate providers based on configured API keys.
- **TaskQueue** — in-memory priority queue with deduplication. Priorities: feedback (1, highest) > new tasks (2) > retries (3). Tasks are deduplicated by ID — once a task enters the queue, duplicate poll results are ignored.
- **TaskRunner** — manages the full task lifecycle: clones the repo (if not cached), creates a git worktree, builds the prompt, spawns the agent subprocess, then commits/pushes/creates a PR on success. Runs up to `maxConcurrent` tasks simultaneously.
- **State file** — `~/.pergentic/state.json` is written every 3 seconds and read by CLI commands (`status`, `dashboard`). No IPC between CLI and daemon for reads.
- **HTTP server** — `localhost:{statusPort}` handles write operations: `POST /retry` re-queues a task, `POST /cancel` sends SIGTERM to an agent process.

## Configuration

### Global Configuration (`~/.pergentic/config.yaml`)

Controls daemon-wide behavior:

```yaml
pollInterval: 30          # Seconds between task polls (min: 5)
maxConcurrent: 2          # Max concurrent task executions (min: 1)
statusPort: 7890          # HTTP status endpoint port

# Notifications
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

# Remote daemon access
remotes:
  prod:
    host: user@prod.example.com
    port: 7890
```

### Project Configuration (`<project>/.pergentic/config.yaml`)

Per-project settings including agent selection, API keys, and integrations:

```yaml
repo: git@github.com:owner/repo.git
branch: main

# Agent selection
agent: claude-code                    # Default agent for this project
configuredAgents:                     # All enabled agents
  - claude-code
  - aider
agentProviders:                       # API provider per agent
  claude-code: anthropic
  aider: openrouter
agentTools:                           # Allowed tools per agent
  claude-code:
    - Edit
    - Write
    - Read
    - Bash
    - Glob
    - Grep

# API keys (per-project, takes precedence over env vars)
anthropicApiKey: sk-ant-...
githubToken: ghp_...
linearApiKey: lin_api_...
linearTeamId: PROJ

# Claude Code options
claude:
  instructions: CLAUDE.md             # Custom instructions file for agent
  maxCostPerTask: 5.00                # Kill agent if cost exceeds this (dollars)
  systemContext: ""                    # Additional system prompt context

# PR template
pr:
  titleFormat: "feat: {taskTitle} [{taskId}]"
  bodyTemplate: "Resolves {taskId}"
  labels:
    - ai-generated
    - needs-review
  reviewers:
    - teammate1

# Linear integration
linear:
  triggers:
    onInProgress: true                # Pick up tasks moved to "In Progress"
    onInReview: false
  updateStatus:
    afterPR: "In Review"              # Status after PR is created
    afterMerge: "Done"                # Status after PR is merged

# Feedback loop
feedback:
  listenTo:
    issueComments: true               # React to issue comments
    reviewComments: true              # React to PR review comments
    reviewRequests: false
  ignoreUsers:
    - pergentic[bot]                  # Don't re-trigger on bot's own comments
  maxRounds: 5                        # Max feedback iterations per task

# Slack channel-to-project mapping
slack:
  channels:
    C0123456789: project-name
```

### Environment Variables

API keys can also be provided via environment variables. Project-level keys in `.pergentic/config.yaml` take precedence.

| Variable | Description |
|---|---|
| `PERGENTIC_HOME` | Override the default `~/.pergentic` data directory |
| `PERGENTIC_LOG_LEVEL` | Log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal` (default: `info`) |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude Code |
| `OPENAI_API_KEY` | OpenAI API key for Codex |
| `OPENROUTER_API_KEY` | OpenRouter API key (multi-provider) |
| `GITHUB_TOKEN` | GitHub personal access token |
| `LINEAR_API_KEY` | Linear API key |

## Supported Agents

| Agent | Provider(s) | Command | Tool Configuration |
|---|---|---|---|
| `claude-code` | Anthropic | `claude -p "{prompt}" --allowedTools Edit,Read,...` | Configurable (default: Edit, Write, Read, Bash, Glob, Grep, WebFetch, WebSearch; optional: NotebookEdit, Agent) |
| `codex` | OpenAI | `codex --quiet "{prompt}" [--full-auto]` | Configurable (shell, file_edit, file_write) |
| `aider` | Anthropic, OpenAI, OpenRouter | `aider --message "{prompt}" --yes` | Managed by Aider internally |
| `opencode` | Anthropic, OpenAI | `opencode run "{prompt}" --tool edit ...` | Configurable (edit, write, read, bash, glob, grep; optional: web_fetch) |

Each agent is a thin adapter that builds CLI arguments. The agent interface requires only three things: `buildCommand()`, `isInstalled()`, and a tools list. See [Adding a new agent](#adding-a-new-agent) for details.

## Supported Task Providers

| Provider | Trigger | Features |
|---|---|---|
| **Linear** | Issue moved to "In Progress" | Auto status updates ("In Review", "Done"), team filtering via `linearTeamId`, polls up to 20 issues per cycle |
| **GitHub** | Issue assigned | PR creation via REST API, review comment detection for feedback loop, polls assigned issues + recent comments |
| **Slack** | `@pergentic` mention | Channel-to-project mapping, Socket Mode (no public URL needed), parses `@pergentic [in <project>] <description>` |

## Feedback Loop

Pergentic tracks feedback history in each worktree (`.claude-history.json`). When a reviewer comments on a PR:

1. The daemon detects the new comment (feedback tasks get priority 1 — highest)
2. Loads the full feedback history for that task
3. Builds a structured prompt with the original task + all prior feedback rounds
4. Re-runs the agent in the same worktree
5. Amends the commit and force-pushes to update the PR

This continues for up to `feedback.maxRounds` iterations (default: 5).

The feedback prompt includes full context:

```
You're working on task {taskId}: {originalDescription}

Previous feedback applied:
  Round 1: "The sidebar overlaps on mobile"

New feedback (Round 2):
  "Also fix the header padding"

Apply the requested changes without regressing on previous fixes.
```

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
# ~/.pergentic/config.yaml
remotes:
  prod:
    host: user@prod.example.com
    port: 7890
```

```bash
pergentic status --remote prod
```

This opens an SSH tunnel to the remote host and fetches the daemon's `/status` HTTP endpoint.

## Examples

### Automate a Linear workflow

```bash
# Initialize project with Linear integration
pergentic init ./my-app

# During init, configure Linear with your API key and team ID
# Then edit .pergentic/config.yaml to set trigger behavior:
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
    C0123456789: api-service
    C9876543210: web-frontend
```

Then in Slack:

```
@pergentic fix the login page redirect bug
@pergentic in api-service add rate limiting to the /users endpoint
```

Pergentic responds in the thread with progress updates and the PR link.

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

### Retry a failed task

```bash
pergentic logs -n 20       # Find the task ID in recent logs
pergentic retry PER-42     # Retry it (re-queued at priority 3)
```

### Run as a system service

```bash
pergentic service install
# Generates a launchd (macOS) or systemd (Linux) service config
# Follow the printed instructions to load it
# Pergentic will start automatically on boot
```

## File System Layout

```
~/.pergentic/                        # Override with PERGENTIC_HOME env var
├── config.yaml                      # Global configuration (polling, notifications, remotes)
├── projects.yaml                    # Registered project paths
├── daemon.pid                       # PID of the running daemon
├── daemon.log                       # Daemon logs (Pino JSON format)
├── state.json                       # Live daemon state (updated every 3s)
├── stats.json                       # Daily task/cost statistics
└── workspaces/
    └── <project-name>/
        ├── repo/                    # Cached repository clone
        └── worktrees/
            └── <taskId>/            # Isolated worktree per task
                └── .claude-history.json  # Feedback history for this task

<project-root>/
└── .pergentic/
    └── config.yaml                  # Project-specific settings
```

## Tech Stack

| Component | Technology |
|---|---|
| Language | TypeScript (ES2022, ESM) |
| Runtime | Node.js >= 20 |
| CLI framework | Commander.js |
| Configuration | YAML + Zod validation |
| TUI dashboard | Ink (React for the terminal) |
| Interactive prompts | @inquirer/prompts |
| Git operations | simple-git |
| Logging | Pino + pino-pretty |
| Bundler | tsup (esbuild-based, code-splitting) |
| Tests | Vitest |

## Development

### Setup

```bash
git clone <repo-url>
cd pergentic-cli
npm install
```

### Scripts

| Script | Description |
|---|---|
| `npm run dev` | Run CLI directly via tsx (no build needed) |
| `npm run build` | Build to `dist/` (tsup, ESM output, 3 entry points) |
| `npm run test` | Run tests with Vitest |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Type-check with `tsc --noEmit` |
| `npm run clean` | Remove `dist/` directory |

### Running locally

```bash
# Run without building (development mode)
npm run dev -- init ./my-project
npm run dev -- start
npm run dev -- status

# Or build and link globally
npm run build
npm link
pergentic --version
```

### Project Structure

```
src/
├── bin/pergentic.ts        # CLI entry point (shebang → cli.ts run())
├── cli.ts                  # Command definitions (Commander.js)
├── daemon.ts               # Background daemon (HTTP server + poll/dispatch loop)
├── agents/                 # AI agent adapters
│   ├── types.ts            # Agent, AgentCommand, AgentOptions, AgentToolDef interfaces
│   ├── resolve-agent.ts    # Agent registry and resolver
│   ├── claude-code.ts      # Claude Code adapter
│   ├── codex.ts            # OpenAI Codex adapter
│   ├── aider.ts            # Aider adapter
│   ├── opencode.ts         # OpenCode adapter
│   └── mock.ts             # Mock agent for testing
├── commands/               # CLI command handlers
│   ├── init.ts             # Interactive 4-step wizard + integration menu
│   ├── add.ts              # Register project
│   ├── remove.ts           # Unregister project
│   ├── list.ts             # List projects
│   ├── start.ts            # Fork daemon process, write PID
│   ├── stop.ts             # Send SIGTERM to daemon
│   ├── restart.ts          # Stop then start with 500ms delay
│   ├── status.ts           # Read state.json or SSH tunnel to remote
│   ├── dashboard.tsx       # Polling TUI dashboard (Ink/React)
│   ├── logs.ts             # Read/tail daemon.log, parse Pino JSON
│   ├── retry.ts            # POST /retry to daemon HTTP endpoint
│   ├── cancel.ts           # POST /cancel to daemon HTTP endpoint
│   └── service.ts          # systemd/launchd service generation
├── core/                   # Task execution engine
│   ├── runner.ts           # TaskRunner: spawn agent, git ops, create PR
│   ├── poller.ts           # Poll all providers → queue → dispatch to runner
│   ├── queue.ts            # In-memory priority queue with dedup
│   ├── worktree.ts         # Git worktree lifecycle (create, list, cleanup)
│   ├── git.ts              # commitAll, pushBranch, createPR (GitHub REST API)
│   ├── feedback.ts         # .claude-history.json management
│   ├── cost.ts             # Per-task cost tracking and daily aggregates
│   └── notify.ts           # Slack/Discord webhook notifications
├── providers/              # Task source integrations
│   ├── types.ts            # IncomingTask, TaskResult, TaskProvider interfaces
│   ├── linear.ts           # Linear GraphQL provider
│   ├── github.ts           # GitHub REST provider
│   └── slack.ts            # Slack Socket Mode provider
├── config/                 # Configuration management
│   ├── schema.ts           # Zod schemas (GlobalConfig, ProjectConfig, ProjectsRegistry)
│   ├── loader.ts           # YAML config read/write helpers
│   └── paths.ts            # Config file path resolution
└── utils/                  # Shared utilities
    ├── logger.ts           # Pino logger factory (CLI=pretty stderr, daemon=file)
    ├── process.ts          # spawnAsync helper with timeout
    └── health.ts           # PID file management and process health checks
```

### Adding a new agent

Implement the `Agent` interface in `src/agents/`:

```typescript
import type { Agent, AgentCommand, AgentOptions, AgentToolDef } from "./types";
import { spawnAsync } from "../utils/process";

export const myAgent: Agent = {
  name: "my-agent",
  tools: [
    { name: "edit", description: "Edit files", default: true },
    { name: "bash", description: "Run commands", default: true },
  ],

  buildCommand(prompt: string, workdir: string, options?: AgentOptions): AgentCommand {
    const args = ["run", prompt];
    if (options?.allowedTools?.length) {
      args.push("--tools", options.allowedTools.join(","));
    }
    return { command: "my-agent-cli", args };
  },

  async isInstalled(): Promise<boolean> {
    try {
      const result = await spawnAsync("my-agent-cli", ["--version"], { timeout: 5000 });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  },
};
```

Then register it in `src/agents/resolve-agent.ts` by adding it to the agents map.

### Adding a new provider

Implement the `TaskProvider` interface in `src/providers/`:

```typescript
import type { TaskProvider, IncomingTask, TaskResult, ProjectContext } from "./types";

export class MyProvider implements TaskProvider {
  async poll(context: ProjectContext): Promise<IncomingTask[]> {
    // Fetch tasks from external service
    // Return them as IncomingTask objects
  }

  async onComplete(task: IncomingTask, result: TaskResult): Promise<void> {
    // Update external service after task completion (e.g., change status)
  }
}
```

Then instantiate it in the poller (`src/core/poller.ts`) based on the project's config keys.

## Troubleshooting

### Daemon won't start

```bash
# Check if already running
pergentic status

# If the process is dead but PID file remains
pergentic stop        # Cleans up stale PID
pergentic start       # Fresh start
```

### Agent not found

Ensure the coding agent CLI is installed and accessible in your `PATH`:

```bash
claude --version      # Claude Code
codex --version       # Codex
aider --version       # Aider
opencode --version    # OpenCode
```

### Tasks not being picked up

1. Verify the daemon is running: `pergentic status`
2. Check logs for errors: `pergentic logs -f`
3. Ensure the task provider is configured correctly (API keys, team IDs)
4. For Linear: verify the task is in "In Progress" state and `linearTeamId` matches your team
5. For GitHub: verify the issue is assigned to someone

### PR creation fails

- Verify `githubToken` has `repo` scope permissions
- Check that the repo URL in config matches the actual remote (supports both HTTPS and SSH formats)
- Review logs for detailed error messages: `pergentic logs -n 100`

### Worktree issues

```bash
# Worktrees are stored under ~/.pergentic/workspaces/<project>/worktrees/
# Stale worktrees older than 7 days are auto-cleaned

# Manually inspect
ls ~/.pergentic/workspaces/

# Check daemon logs for worktree errors
pergentic logs --project <name>
```

### Config validation errors

All config files are validated through Zod schemas at load time. If you see a validation error:

1. Check YAML syntax (indentation, quoting)
2. Ensure required fields are present (`repo` is required in project config)
3. Verify API key prefixes: `sk-ant-` (Anthropic), `sk-` (OpenAI), `ghp_` or `github_pat_` (GitHub), `lin_api_` (Linear)

## Design Decisions

- **Polling over webhooks** — No public URL or tunnel required. Works behind firewalls, NATs, and corporate VPNs. 30-second latency is acceptable for CI-like workflows.
- **Git worktrees over branches** — Each task gets a fully isolated directory. Multiple agents can run in parallel without conflicts, and worktrees persist for feedback iterations. Stale worktrees are auto-cleaned after 7 days.
- **In-memory queue** — No external dependencies like Redis. State is ephemeral — if the daemon restarts, providers simply re-poll and rediscover active tasks.
- **Modular agent adapters** — Each coding agent is a thin wrapper that builds CLI arguments. Adding a new agent means implementing `buildCommand()`, `isInstalled()`, and a tools list.
- **Per-project API keys** — Credentials are stored in the project config, allowing different projects to use different API keys and agents simultaneously. Project keys override environment variables.
- **Direct GitHub API** — PR creation uses the GitHub REST API directly rather than requiring the `gh` CLI. Only `git` needs to be installed on the host.
- **Config validation at load time** — All config files are parsed through Zod schemas on every load, catching misconfigurations immediately with descriptive errors.

## Security

- API keys are stored in project-level config files (`<project>/.pergentic/config.yaml`). Ensure these files are in your `.gitignore`.
- The daemon's HTTP endpoint binds to `localhost` only — it is not accessible from external networks.
- Agent processes are spawned with only the necessary environment variables (e.g., `ANTHROPIC_API_KEY`).
- The `pergentic init` wizard validates API key prefixes to catch misconfiguration early.

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes and add tests
4. Run the test suite: `npm run test`
5. Type-check: `npm run lint`
6. Submit a pull request

Conventions:
- Branch names: `feat/`, `fix/`, `chore/`, `docs/` prefixes
- Commit messages: conventional commits (`feat:`, `fix:`, `chore:`, etc.)

## License

MIT
