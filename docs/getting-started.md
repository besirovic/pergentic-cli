# Getting Started

## Prerequisites
- Node.js 20+
- git
- At least one coding agent installed (Claude Code, Codex, Aider, or OpenCode)
- API keys for your ticket source (Linear API key or GitHub token)

## Install
```bash
npm install -g pergentic
```

## Initialize a Project
Run `pergentic init` in your repo directory. The wizard walks through:
1. Detecting git remote URL (or prompting for it)
2. Selecting a base branch (default: main)
3. Choosing a coding agent
4. Entering API keys (stored in `.pergentic/.env`, not config.yaml)
5. Configuring providers (Linear, GitHub)

This creates `.pergentic/config.yaml` and `.pergentic/.env` in your project, and registers the project in `~/.pergentic/projects.yaml`.

## Start the Daemon
```bash
pergentic start
```
The daemon runs in the background. It polls your configured providers, queues tasks, and dispatches agents.

## Verify It Works
```bash
pergentic status    # Check daemon state
pergentic logs -f   # Follow daemon logs
```

## What Happens Next
When the daemon finds an assigned ticket (e.g., a Linear issue moved to "In Progress"):
1. It creates a git worktree for isolation
2. Spawns the configured agent with the ticket description
3. Runs verification commands if configured (tests, lint)
4. Creates a PR on GitHub
5. Updates the ticket status (e.g., to "In Review")

The PR appears in your repository with labels `ai-generated` and `needs-review`.
