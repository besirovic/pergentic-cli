# Cost Tracking

Pergentic tracks task costs and maintains a history of all executed tasks.

## Task History

Stored at `~/.pergentic/stats.json`. Each entry records:

| Field | Type | Description |
|-------|------|-------------|
| `taskId` | string | Unique task identifier |
| `cost` | number | Estimated cost in USD |
| `duration` | number | Execution time in seconds |
| `timestamp` | string | ISO 8601 timestamp |
| `project` | string | Project name |
| `title` | string | Task title |
| `status` | string | `"success"` or `"failed"` |
| `prUrl` | string | URL of created PR (if any) |
| `error` | string | Error message (if failed) |

## Daily Aggregation

Stats are aggregated by calendar date (UTC) alongside the task history. Each day entry tracks:

- Total tasks run
- PRs created
- Failed tasks
- Estimated total cost

## Viewing History

```bash
pergentic history                    # Recent tasks (default: 20)
pergentic history -n 50              # Last 50 tasks
pergentic history --project myapp    # Filter by project
pergentic history <taskId>           # Details for one task
```

The detail view also prints a retry command when the task failed:

```
Task:      abc-123
Title:     Implement feature X
Project:   myapp
Status:    failed
Duration:  2m 14s
Timestamp: 2025-01-15T10:30:00Z
Error:     Agent exited with code 1: ...

Retry with: pergentic retry abc-123
```

## Cost Limit

Set a maximum cost per task:

```yaml
# In project config (.pergentic/config.yaml)
claude:
  maxCostPerTask: 5.00    # USD
```

## Retention

Stats are pruned automatically:

| Data | Retention |
|------|-----------|
| Task history (`stats.json`) | 90 days |
| Dispatch ledger (`dispatched.jsonl`) | 30 days |

Both are pruned on the same schedule after each poll cycle. Writes to `stats.json` use atomic rename to prevent corruption on crash.
