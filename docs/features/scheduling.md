# Scheduling

Run tasks on a cron schedule. Useful for recurring code maintenance such as dependency updates, automated reviews, or report generation.

## CLI

```bash
pergentic schedule add                  # Create a schedule interactively
pergentic schedule list                 # List all schedules for a project
pergentic schedule remove <name-or-id>  # Delete a schedule
pergentic schedule pause <name-or-id>   # Disable without deleting
pergentic schedule resume <name-or-id>  # Re-enable a paused schedule
```

## Types

### Prompt

Sends a prompt file to a coding agent. The agent runs in a git worktree and can create a PR.

```yaml
- name: daily-review
  cron: "0 9 * * 1-5"
  type: prompt
  prompt: schedules/daily-review.md
  prBehavior: new
```

Prompt files live at `.pergentic/schedules/<name>.md` within the project. The `prompt` field is a path relative to `.pergentic/`. `pergentic schedule add` creates the file and optionally opens it in `$EDITOR`.

Pergentic skips a scheduled run if the prompt file is empty or still contains the default template placeholder.

### Command

Runs a shell command via `sh -c` in the project worktree. No agent is involved.

```yaml
- name: nightly-cleanup
  cron: "0 2 * * *"
  type: command
  command: "npm run cleanup"
```

## PR Behavior

| Value | Behavior |
|-------|----------|
| `new` | Creates a new branch and PR on each run (default) |
| `update` | Pushes to a fixed branch (`prBranch`). Creates a PR on the first run, updates on subsequent runs. |

For `update` mode, `prBranch` is required:

```yaml
prBehavior: update
prBranch: chore/weekly-deps
```

## Timeout

Default: 30 minutes (1,800,000 ms). Minimum: 1,000 ms.

```yaml
scheduleTimeout: 3600000    # 1 hour, in milliseconds
```

## Agent Selection

For `prompt`-type schedules, you can specify which agent to use:

```yaml
- name: daily-review
  type: prompt
  agent: claude-code
  prompt: schedules/daily-review.md
  cron: "0 9 * * 1-5"
```

If `agent` is omitted, the project default agent is used.

## Configuration File

Schedules are stored in `.pergentic/schedules.yaml` within the project directory. Each entry has an auto-generated `id` (8-char UUID prefix) and a `name` (lowercase alphanumeric with hyphens).

## Execution

Schedules are checked after each poll cycle via the `afterPollHook`. The scheduler determines if a schedule is due by finding the next cron occurrence after `lastRun` and comparing it to the current time. A schedule with no `lastRun` is considered due if its first occurrence has already passed.

Concurrent duplicate runs of the same schedule are prevented: if a schedule is already active or already queued, the check is skipped.

On dispatch, `lastRun` is updated immediately. If dispatch fails, the schedule is removed from the active set and retried on the next cycle.
