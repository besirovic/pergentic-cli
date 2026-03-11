# pergentic

Turn project management tickets into pull requests autonomously.

[![npm](https://img.shields.io/npm/v/pergentic?style=flat-square)](https://www.npmjs.com/package/pergentic)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![build](https://img.shields.io/github/actions/workflow/status/org/pergentic/ci.yml?style=flat-square)](https://github.com/org/pergentic/actions)

## What It Does

Pergentic runs as a background daemon that polls your project management tools (Linear, GitHub) for assigned tickets. Each ticket is picked up by a coding agent running in an isolated git worktree, which implements the changes and opens a pull request. Review comments on the PR feed back into the agent, which reworks the code and updates the PR. The cycle continues until the PR is approved and merged.

## Flow

```
Ticket (Linear/GitHub) → Poller → Queue → Agent (in worktree) → PR
                                                                   ↓
                                              PR review comments → Agent (rework)
```

## Quick Start

```bash
npm install -g pergentic
```

```bash
pergentic init
# configure API keys and select agent
```

```bash
pergentic start
```

```bash
pergentic status
```

## Features

- Polls Linear and GitHub for assigned tickets
- Runs coding agents (Claude Code, Codex, Aider, OpenCode) in isolated git worktrees
- Creates PRs with configurable titles, labels, and reviewers
- PR review comments trigger automatic rework (feedback loop)
- Verification commands (tests, lint) run after each agent pass
- Cron-based scheduled tasks (code review, dependency updates)
- Slack, Discord, and desktop notifications
- Cost tracking and task history
- Label-based agent and model routing
- Remote daemon monitoring via SSH tunnel

## Configuration

Global configuration lives in `~/.pergentic/config.yaml`:

```yaml
# ~/.pergentic/config.yaml
pollInterval: 30
maxConcurrent: 2
```

Per-project configuration lives in `.pergentic/config.yaml` at the root of each repository:

```yaml
# .pergentic/config.yaml
repo: git@github.com:org/repo.git
agent: claude-code
```

Run `pergentic init` in a project directory to generate these files interactively.

## Documentation

- [Getting Started](docs/getting-started.md) — full setup walkthrough
- [How It Works](docs/how-it-works.md) — architecture and task lifecycle
- [CLI Reference](docs/cli-reference.md) — every command, flag, and argument
- **Configuration**
  - [Global Config](docs/configuration/global-config.md) — `~/.pergentic/config.yaml`
  - [Project Config](docs/configuration/project-config.md) — `.pergentic/config.yaml`
  - [Schedules](docs/configuration/schedules.md) — `.pergentic/schedules.yaml`
  - [Environment Variables](docs/configuration/environment.md) — env vars and secrets
- **Providers**
  - [Linear](docs/providers/linear.md) | [GitHub](docs/providers/github.md) | [Slack](docs/providers/slack.md) | [Jira](docs/providers/jira.md)
- **Agents**
  - [Overview](docs/agents/overview.md) | [Claude Code](docs/agents/claude-code.md) | [Codex](docs/agents/codex.md) | [Aider](docs/agents/aider.md) | [OpenCode](docs/agents/opencode.md)
- **Features**
  - [Verification](docs/features/verification.md) | [Feedback Loop](docs/features/feedback-loop.md) | [Notifications](docs/features/notifications.md) | [Cost Tracking](docs/features/cost-tracking.md)
  - [Branching](docs/features/branching.md) | [PR Creation](docs/features/pr-creation.md) | [Scheduling](docs/features/scheduling.md) | [Remote Status](docs/features/remote-status.md)
- **Deployment**
  - [systemd (Linux)](docs/deployment/systemd.md) | [launchd (macOS)](docs/deployment/launchd.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Security](docs/security.md)
- [Internals](docs/internals.md) — hardcoded defaults and limits

## License

MIT
