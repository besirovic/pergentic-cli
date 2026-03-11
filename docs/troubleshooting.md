# Troubleshooting

## Enable Debug Logging

```bash
# One-time
PERGENTIC_LOG_LEVEL=debug pergentic start

# Persistent (add to shell profile)
export PERGENTIC_LOG_LEVEL=debug
```

Or use `--verbose` on any command:

```bash
pergentic status --verbose
```

## Log Location

Daemon logs: `~/.pergentic/daemon.log` (JSONL format, one JSON object per line).

```bash
pergentic logs -f                    # Follow logs
pergentic logs -n 100                # Last 100 lines
pergentic logs --project myapp       # Filter by project
```

For large log files, `pergentic logs` warns when the file exceeds 500 MB and suggests using `tail -f` directly. The maximum it reads into memory at once is 10 MB.

## Common Issues

### Daemon won't start

**Lock file exists**: Another daemon instance may be running, or a previous instance didn't shut down cleanly.

Check:

```bash
ls ~/.pergentic/daemon.lock
cat ~/.pergentic/daemon.pid
```

If the process listed in `daemon.pid` is not running, the lock is stale. Stop the daemon first (`pergentic stop`) or remove the lock file manually if the process is confirmed dead.

**Port already in use**: The status HTTP server (default port: 7890) is occupied by another process.

Solution: Change `statusPort` in `~/.pergentic/config.yaml` or stop the conflicting process.

### Agent not found

The agent CLI must be installed and available in `PATH`. Pergentic checks with a `--version` call (5-second timeout).

```bash
# Verify manually
claude --version
codex --version
aider --version
opencode --version
```

If the binary exists but is not on `PATH` in the daemon's environment (common with service managers), add its directory to the `PATH` in the unit file or plist.

### API key invalid

Keys are validated against expected prefix patterns at startup:

| Provider | Expected Prefix |
|----------|----------------|
| Anthropic | `sk-ant-` |
| OpenAI | `sk-` |
| GitHub | `ghp_`, `gho_`, `ghu_`, `ghs_`, `github_pat_` |
| Linear | `lin_api_` |
| OpenRouter | `sk-or-v1-` |
| Slack Bot | `xoxb-` |
| Slack App | `xoxp-` |

Placeholder values (`your_key_here`, `TODO`, `CHANGEME`, `REPLACE_ME`, `xxx`, `placeholder`, empty strings) are rejected.

To bypass validation entirely:

```bash
export PERGENTIC_SKIP_SECRET_VALIDATION=1
```

### Git authentication failure

Pergentic uses whatever git credentials are configured on your system. For SSH repos, ensure your SSH key is loaded:

```bash
ssh-add -l
```

For HTTPS repos, ensure a credential helper is configured (`git config --global credential.helper`). The daemon does not prompt interactively; authentication must succeed non-interactively.

### No tasks being picked up

Check each of these in order:

1. Daemon is running: `pergentic status`
2. Provider API keys are valid: check `~/.pergentic/.env` and `.pergentic/.env`
3. Tickets meet the trigger criteria:
   - Linear: issue must be in "In Progress" state (default trigger)
   - GitHub: issue must be open and assigned
4. Task hasn't already been dispatched: check `~/.pergentic/dispatched.jsonl` for the task ID
5. Project is registered: `pergentic list`

### Dashboard stops updating

The dashboard exits after 3 consecutive failures to read the daemon state file. This usually means the daemon stopped. Check with `pergentic status` and restart the dashboard with `pergentic dashboard` after the daemon is running again.

## State Files

| File | Purpose |
|------|---------|
| `~/.pergentic/daemon.pid` | Process ID of running daemon |
| `~/.pergentic/daemon.lock` | Lock file preventing multiple instances |
| `~/.pergentic/daemon.log` | Structured log output (JSONL) |
| `~/.pergentic/state.json` | Current daemon state snapshot (updated every 3s) |
| `~/.pergentic/stats.json` | Task cost history and daily statistics |
| `~/.pergentic/events.jsonl` | Task lifecycle event log (capped at 10,000 entries) |
| `~/.pergentic/dispatched.jsonl` | Dispatch deduplication ledger (30-day retention) |

### Stale State After Crash

If the daemon crashes without cleanup, `daemon.pid` and `daemon.lock` may be stale. The daemon detects stale locks on startup using POSIX process signaling — if the process in the lock file is dead, the lock is reclaimed automatically. If it fails to do so, remove the files manually:

```bash
rm ~/.pergentic/daemon.pid ~/.pergentic/daemon.lock
```

### Dispatch Ledger Corruption

If `dispatched.jsonl` has 5 or more malformed lines, the daemon logs an error and creates a backup (`dispatched.jsonl.corrupt.<timestamp>.bak`). Previously dispatched task IDs may be lost, which can cause tasks to be dispatched again. Review the backup to identify the scope of the issue.
