# Schedules Configuration

Location: `.pergentic/schedules.yaml`

Defines recurring tasks that run on a cron schedule.

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | — | Unique identifier (auto-generated). |
| `name` | string | — | Human-readable name. |
| `cron` | string | — | Cron expression (standard 5-field: minute hour day month weekday). |
| `type` | enum | — | `"prompt"` (send to coding agent) or `"command"` (run shell command). |
| `prompt` | string | — | Path to prompt file. Required if type is `prompt`. |
| `command` | string | — | Shell command to run. Required if type is `command`. |
| `agent` | enum | — | Override agent for this schedule. Options: `claude-code`, `codex`, `aider`, `opencode`. |
| `branch` | string | `"main"` | Base branch for the worktree. |
| `prBehavior` | enum | `"new"` | `"new"` creates a fresh PR each run. `"update"` pushes to an existing branch. |
| `prBranch` | string | — | Target branch name. Required if `prBehavior` is `"update"`. |
| `scheduleTimeout` | number | `1800000` | Timeout in milliseconds. Minimum: 1000. |
| `enabled` | boolean | `true` | Whether this schedule is active. |
| `lastRun` | string | — | ISO timestamp of last execution. Auto-managed. |
| `createdAt` | string | — | ISO timestamp of creation. Auto-set. |

## Cron Format

Standard 5-field cron: `minute hour day-of-month month day-of-week`

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-6, 0=Sunday)
│ │ │ │ │
* * * * *
```

## Prompt vs Command

**Prompt type**: Reads a prompt file from `.pergentic/schedules/`, sends it to a coding agent, and creates a PR with the results. Use this for code changes.

**Command type**: Runs a shell command directly. No agent involved, no PR created. Use this for maintenance tasks like cache clearing or report generation.

## PR Behavior

- `"new"` — Creates a new branch and PR each time the schedule runs. Branch name includes the schedule ID.
- `"update"` — Pushes to a fixed branch (`prBranch`). Creates a PR on the first run, then updates the same branch on subsequent runs. Useful for standing PRs like dependency updates.

## Examples

### Daily code review
```yaml
schedules:
  - id: daily-review
    name: Daily Code Review
    cron: "0 9 * * 1-5"
    type: prompt
    prompt: schedules/daily-review.md
    agent: claude-code
    branch: main
    prBehavior: new
    enabled: true
```

### Weekly dependency update
```yaml
schedules:
  - id: deps-update
    name: Weekly Dependency Update
    cron: "0 6 * * 1"
    type: prompt
    prompt: schedules/update-deps.md
    prBehavior: update
    prBranch: chore/dependency-updates
    enabled: true
```

### Nightly cleanup command
```yaml
schedules:
  - id: nightly-cleanup
    name: Nightly Cache Cleanup
    cron: "0 2 * * *"
    type: command
    command: "npm run cleanup"
    enabled: true
```

Prompt files are stored in `.pergentic/schedules/`. Schedules are checked after each poll cycle.
