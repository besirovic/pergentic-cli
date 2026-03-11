# Internals

Hardcoded defaults and limits that are not configurable unless noted.

## Timeouts

| What | Value | Source |
|------|-------|--------|
| Git operations (clone, push, pull, commit) | 60 seconds | `src/core/worktree.ts` |
| SIGTERM → SIGKILL escalation | 10 seconds | `src/utils/process.ts` |
| Agent version check | 5 seconds | `src/agents/resolve-agent.ts` |
| HTTP keep-alive (outbound client) | 30 seconds | `src/utils/http.ts` |
| HTTP keep-alive max (outbound client) | 60 seconds | `src/utils/http.ts` |
| Daemon API request | 5 seconds | `src/utils/daemon-server.ts` |
| Graceful shutdown | 5 minutes | `src/config/constants.ts` |
| SSH tunnel establishment | 2 seconds | `src/config/constants.ts` |
| Default agent execution | 3,600 seconds (1 hour) | `src/config/schema.ts` (configurable via `claude.agentTimeout`) |
| Default verification command | 300 seconds | `src/config/schema.ts` (configurable via `verification.commandTimeout`) |

## Buffer Sizes

| What | Limit | Source |
|------|-------|--------|
| Agent process stdout/stderr buffer | 8 KB (last 8 KB retained on overflow) | `src/utils/process.ts` |
| PR template file | 10 KB (truncated if exceeded) | `src/core/pr-template.ts` |
| PR/issue comment body | 65,536 characters | `src/providers/github.ts` |
| Verification error output passed to agent | 3,000 characters | `src/core/verify.ts` |
| Verification output in PR comment | 1,500 characters | `src/core/comments.ts` |
| Max log read into memory | 10 MB | `src/config/constants.ts` |
| Log size warning threshold | 500 MB | `src/config/constants.ts` |
| Log read chunk size | 8 KB | `src/config/constants.ts` |
| Agent error snippet in failure message | 2,000 characters | `src/core/ticket-executor.ts` |

## Rate Limits (Daemon API)

| Endpoint | Limit | Window |
|----------|-------|--------|
| `GET /status` | 120 requests | 60 seconds |
| `POST /retry`, `POST /cancel` | 30 requests | 60 seconds |
| Request body | 1 MB | per request |
| Request timeout | 5 seconds | per request |

## Storage Limits

| What | Limit | Source |
|------|-------|--------|
| Event log entries (`events.jsonl`) | 10,000 | `src/config/constants.ts` |
| Stats retention | 90 days | `src/config/constants.ts` |
| Dispatch ledger retention | 30 days | `src/core/ledger.ts` |
| Dispatch ledger corruption threshold | 5 bad entries (triggers backup) | `src/core/ledger.ts` |
| Scheduler `lastDispatched` map | 1,000 entries | `src/core/scheduler.ts` |
| Linear provider LRU cache | 256 entries | `src/providers/linear.ts` |

## HTTP Client

| Setting | Value |
|---------|-------|
| Max concurrent connections | 10 |
| Retry attempts | 3 |
| Base retry delay | 1 second |
| Retry jitter | up to 500 ms |
| Retryable HTTP statuses | 429, 500, 502, 503, 504 |

The retry delay uses exponential backoff: `baseDelay * 2^attempt + random(0, 500ms)`. If the server returns a `Retry-After` header, that value takes precedence.

## Pagination

| API | Page Size |
|-----|-----------|
| GitHub issues | 20 per page |
| GitHub comments | 50 per page |
| Linear issues | 20 per query |

## Branch Naming

| Setting | Value |
|---------|-------|
| Slug max length | 50 characters |
| Hash suffix length | 7 characters (SHA-256, hex) |
| Default template | `{taskId}-{title}` |

Available template variables: `taskId`, `title`, `source`, `type`, `project`, `agent`, `date`, `timestamp`, `shortHash`. The `{taskId}` variable is required in all templates.

Branch names are sanitized after template rendering: whitespace, `~`, `^`, `:`, `?`, `*`, `[`, `]`, `\` are replaced with `-`; consecutive separators are collapsed; leading/trailing separators and `.lock` suffixes are removed.

## State Management

| Setting | Value | Source |
|---------|-------|--------|
| State file update interval | 3 seconds | `src/config/constants.ts` |
| Stats cache TTL | 30 seconds | `src/config/constants.ts` |
| Comment poll window | 2 minutes | `src/config/constants.ts` |
| Dashboard refresh interval | 1 second | `src/config/constants.ts` |
| Dashboard failure threshold | 3 consecutive failures | `src/commands/dashboard.ts` |

## Git Push Retries

Push retries are not built into the git layer directly. The feedback executor has pull-before-push logic with error recovery, but there is no automatic push retry loop. Transient push failures surface as task failures.

## File Permissions

All files containing sensitive data are written with `0o600` (owner read/write only):

| File | Mode |
|------|------|
| `~/.pergentic/daemon.pid` | 0o600 |
| `~/.pergentic/daemon.lock` | 0o600 |
| `~/.pergentic/.env` | 0o600 |
| `.pergentic/.env` (per-project) | 0o600 |

Other state files (`state.json`, `stats.json`, `events.jsonl`, `dispatched.jsonl`) inherit the default umask.

## Default Configuration Values

| Setting | Default | Configurable |
|---------|---------|-------------|
| Poll interval | 30 seconds | Yes (`pollInterval` in global config) |
| Max concurrent tasks | 2 | Yes (`maxConcurrent` in global config) |
| Status HTTP port | 7890 | Yes (`statusPort` in global config) |
| Agent timeout | 3,600 seconds | Yes (`claude.agentTimeout` in project config) |
| Verification max retries | 3 | Yes (`verification.maxRetries` in project config) |
| Verification command timeout | 300 seconds | Yes (`verification.commandTimeout` in project config) |
| Agent retry max retries | 0 (disabled) | Yes (`agentRetry.maxRetries` in project config) |
| Agent retry base delay | 30 seconds | Yes (`agentRetry.baseDelaySeconds` in project config) |
| Feedback max rounds | 5 | Yes (`feedback.maxRounds` in project config) |
