# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
yarn run build          # Build with tsup (ESM, node20 target) → dist/
yarn run dev            # Run CLI directly via tsx (no build needed)
yarn run test           # Run all tests with vitest
yarn run test -- src/core/queue.test.ts  # Run a single test file
yarn run test:watch     # Watch mode
yarn run lint           # Type-check only (tsc --noEmit)
```

Package manager is **yarn** (lockfile: `yarn-lock.yaml`). Node >= 20 required.

## Architecture

Pergentic is an autonomous PR generation tool that converts PM tickets (Linear, GitHub, Jira) into pull requests using coding agents. It runs as a background daemon.

### Core Loop

The daemon (`src/daemon.ts`) orchestrates everything:

1. **Poller** (`src/core/poller.ts`) — polls registered projects on an interval. For each project, it instantiates providers based on config (Linear, GitHub) and enqueues incoming tasks.
2. **TaskQueue** (`src/core/queue.ts`) — priority-sorted queue (binary search insertion). Priority: FEEDBACK(1) > NEW(2) > RETRY(3) > SCHEDULED(4). Deduplicates via `seen` set.
3. **TaskRunner** (`src/core/runner.ts`) — dispatches tasks up to `maxConcurrent`. Selects an executor based on task type: `TicketExecutor`, `FeedbackExecutor`, or `ScheduledExecutor`. Each task runs in a git worktree.
4. **Scheduler** (`src/core/scheduler.ts`) — cron-based recurring tasks, checked after each poll via `afterPollHook`.

### Executor Pattern

`TaskExecutor` interface (`src/core/executor-types.ts`): `execute(ctx: ExecutorContext) → ExecutorResult`. Three implementations:

- `TicketExecutor` — new tickets: spawns agent → optional verification → creates PR
- `FeedbackExecutor` — PR review comments: spawns agent on existing branch
- `ScheduledExecutor` — cron tasks: prompt or shell command

### Agent System

Agents (`src/agents/`) implement the `Agent` interface: `buildCommand(prompt, workdir, options) → AgentCommand`. Four agents: `claude-code`, `codex`, `aider`, `opencode`. `resolve-agent.ts` resolves agent name to implementation. Labels in project config can route specific tickets to specific agents/models.

### Provider System

Providers (`src/providers/`) implement `TaskProvider` (via `BaseProvider`): `poll(project) → IncomingTask[]` and `onComplete(project, taskId, result)`. Current: `LinearProvider`, `GitHubProvider`, `SlackProvider`.

### Config

- Global: `~/.pergentic/config.yaml` (validated by `GlobalConfigSchema`)
- Per-project: `<project>/.pergentic/config.yaml` (validated by `ProjectConfigSchema`)
- Projects registry: `~/.pergentic/projects.yaml`
- Schedules: `<project>/.pergentic/schedules.yaml`
- All schemas in `src/config/schema.ts` using Zod

Override base dir with `PERGENTIC_HOME` env var. All path helpers in `src/config/paths.ts`.

### Key Patterns

- **Result type** (`src/types/result.ts`): `Result<T, E>` with `ok()` / `err()` constructors
- **TypedEventEmitter** (`src/types/typed-emitter.ts`): type-safe EventEmitter wrapper used by `TaskRunner`
- **Dependency injection**: `TaskRunner` accepts `RunnerDeps` for testability (`src/core/runner-deps.ts`)
- **Command handler**: `handleCommand()` wrapper (`src/utils/command-handler.ts`) provides uniform error handling for all CLI commands
- **Dispatch ledger** (`src/core/ledger.ts`): persistent JSONL deduplication of dispatched tasks
- **Daemon IPC**: HTTP server on localhost (`src/utils/daemon-server.ts`) with routes for status/retry/cancel. CLI commands communicate via `daemon-client.ts`.

### Build

tsup bundles three entry points: `src/cli.ts`, `src/daemon.ts`, `src/bin/pergentic.ts`. ESM only, code-splitting enabled. `ink` and `react` are external (used by dashboard).

### Tests

Tests are colocated (`*.test.ts` next to source). Vitest with `globals: true`. The runner uses dependency injection — test files mock via `RunnerDeps` rather than module mocking.
