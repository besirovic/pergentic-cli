# How It Works

Architecture overview of the pergentic daemon.

## Task Lifecycle

```
┌─────────────┐     ┌─────────┐     ┌────────────┐     ┌────────────┐     ┌────┐
│ Linear/GitHub│────▶│ Poller  │────▶│ TaskQueue  │────▶│ Runner     │────▶│ PR │
│ Slack/Jira   │     └─────────┘     └────────────┘     └────────────┘     └────┘
└─────────────┘                                               │
                                                     ┌────────┴────────┐
                                                     │    Executor     │
                                                     ├─────────────────┤
                                                     │ TicketExecutor  │
                                                     │ FeedbackExecutor│
                                                     │ScheduledExecutor│
                                                     └─────────────────┘
```

## Polling
The Poller runs on a configurable interval (default: 30s, minimum: 5s). For each registered project, it instantiates the appropriate provider (Linear, GitHub) and fetches new tasks. Provider instances are cached per project and only re-created when API credentials change. Tasks are checked against a persistent dispatch ledger (JSONL file, 30-day retention) and the runner's active task map before being queued.

## Task Queue
Tasks enter a priority-sorted queue. Priority order (highest first):
1. **FEEDBACK (1)** — PR review comments. Processed first so reviewers get fast responses.
2. **NEW (2)** — Fresh tickets from providers.
3. **RETRY (3)** — Previously failed tasks being retried.
4. **SCHEDULED (4)** — Cron-triggered tasks.

The queue uses binary search insertion. Deduplication is handled by a `seen` set (in-memory) and a `failed` set (capped at 10,000 entries) that permanently blocks tasks which failed to start.

## Task Runner
The Runner dispatches tasks from the queue up to `maxConcurrent` (default: 2). For each task:
1. Creates a git worktree in `~/.pergentic/workspaces/<project>/worktrees/<taskId>/`
2. Selects an executor based on task type
3. Spawns the agent process
4. On cancellation: sends SIGTERM, escalates to SIGKILL after 10s if the process has not exited

Failed starts are recorded to the dispatch ledger and will not be retried automatically.

## Executors

**TicketExecutor** — handles new tickets:
1. Initializes feedback history file in the worktree
2. Builds prompt from template (`.pergentic/PROMPT.md`)
3. Spawns agent in worktree
4. Runs verification commands (if configured, up to `maxRetries`, default: 3)
5. Creates PR via GitHub API

**FeedbackExecutor** — handles PR review comments:
1. Pulls the existing branch (fails with actionable error on merge conflicts, diverged history, or network issues)
2. Loads feedback history (`.claude-history.json` in worktree), or initializes it if missing
3. Builds prompt with all previous rounds plus the new comment
4. Spawns agent
5. Amends last commit and force-pushes

**ScheduledExecutor** — handles cron tasks:
- **Command type**: delegates to `ScheduledCommandRunner`, which handles its own lifecycle
- **Prompt type**: runs agent with the schedule's description, runs verification if configured, creates or updates a PR

## Worktree Isolation
Each task runs in its own git worktree, branched from the project's base branch. The repo is cloned to `~/.pergentic/workspaces/<project>/repo/` on first use. Worktree paths are `~/.pergentic/workspaces/<project>/worktrees/<taskId>/`. If a worktree already exists for a task ID (e.g., after a daemon restart), it is reused with its existing branch.

Branch names default to `<taskId>-<slugified-title>`. If the title slugifies to an empty string, a SHA-256 hash prefix is used. Slugs longer than 50 characters are truncated and suffixed with a 7-character hash to prevent collisions.

## Deduplication
Two mechanisms prevent duplicate work:
1. **TaskQueue seen set** — in-memory, prevents the same task from being queued twice within one session. Cleared when a task is dequeued.
2. **Dispatch ledger** — persistent JSONL file (`~/.pergentic/dispatched.jsonl`), survives daemon restarts, 30-day retention. If 5 or more entries are malformed on load, the file is backed up and a corruption warning is logged. Lost entries may cause task duplication.

## Agent Selection
The default agent is set in the project config (`agent` field). Labels on tickets can route to different agents via `agentLabels` or to specific models via `modelLabels`. When `modelLabels` matches, the associated agent is implied — no separate `agentLabels` entry is needed. Multiple model label matches on a single ticket produce separate tasks (and separate PRs) for each matched model. If no labels match any configured routing, the project's default agent is used.
