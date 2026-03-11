# Environment Variables

## API Keys

Store API keys as environment variables, not in config.yaml. The `pergentic init` wizard writes them to `.pergentic/.env` automatically.

| Variable | Required For | Prefix |
|----------|-------------|--------|
| `PERGENTIC_ANTHROPIC_API_KEY` | Claude Code agent | `sk-ant-` |
| `PERGENTIC_OPENAI_API_KEY` | Codex agent | `sk-` |
| `PERGENTIC_GITHUB_TOKEN` | GitHub provider, PR creation | `ghp_`, `gho_`, `ghu_`, `ghs_`, `github_pat_` |
| `PERGENTIC_LINEAR_API_KEY` | Linear provider | `lin_api_` |
| `PERGENTIC_OPENROUTER_API_KEY` | OpenRouter API provider | `sk-or-v1-` |
| `PERGENTIC_SLACK_BOT_TOKEN` | Slack provider (bot) | `xoxb-` |
| `PERGENTIC_SLACK_APP_TOKEN` | Slack provider (app/Socket Mode) | `xoxp-` |
| `PERGENTIC_JIRA_API_TOKEN` | Jira provider | — |
| `PERGENTIC_JIRA_EMAIL` | Jira provider | — |
| `PERGENTIC_JIRA_DOMAIN` | Jira provider | — |

## Configuration Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PERGENTIC_HOME` | Base directory for pergentic data | `~/.pergentic` |
| `PERGENTIC_LOG_LEVEL` | Log level (trace, debug, info, warn, error, fatal) | `info` |
| `PERGENTIC_SKIP_SECRET_VALIDATION` | Set to `1` to skip API key prefix validation | — |

## .env File Locations

| Location | Scope |
|----------|-------|
| `~/.pergentic/.env` | Global — applies to all projects |
| `.pergentic/.env` | Project — applies to one project only |

## Loading Priority

Environment variables are resolved in this order (first match wins):

1. `process.env` — variables set in the shell or system
2. Project `.env` — `.pergentic/.env` in the project directory
3. Global `.env` — `~/.pergentic/.env`

## Secret Validation

API keys are validated against expected prefix patterns. Keys that don't match the expected prefix are rejected at startup. This catches misconfigured keys early.

The following placeholder values are also rejected:
- `your_key_here`, `YOUR_KEY_HERE`
- `TODO`, `CHANGEME`, `REPLACE_ME`
- `xxx`, `placeholder`
- Empty strings

To bypass validation (e.g., for non-standard key formats), set:
```bash
export PERGENTIC_SKIP_SECRET_VALIDATION=1
```

## Migration

If API keys are found in `config.yaml` instead of `.env`, pergentic migrates them automatically on startup. The keys are moved to the appropriate `.env` file and removed from config.yaml.

## Agent Environment

For security, only these environment variables are passed to agent subprocesses:

- `PATH`
- `HOME`
- `SHELL`
- `USER`
- `LANG`
- `LC_ALL`
- `TERM`
- `NODE_ENV`
- `TMPDIR`
- `XDG_RUNTIME_DIR`

All other variables (including API keys) are filtered out. Agent-specific keys are passed through dedicated command flags.
