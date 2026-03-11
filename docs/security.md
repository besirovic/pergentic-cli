# Security

## Secret Storage

API keys are stored in `.env` files:

- Global: `~/.pergentic/.env`
- Per-project: `<project>/.pergentic/.env`

These files are created with `0o600` permissions (owner read/write only). They are not encrypted at rest. Ensure your home directory and project directories have appropriate access controls.

The per-project `.pergentic/.env` path should be in your `.gitignore`.

## Secret Validation

API keys are validated against expected prefix patterns at startup:

| Provider | Expected Prefix |
|----------|----------------|
| Anthropic | `sk-ant-` |
| OpenAI | `sk-` |
| GitHub | `ghp_`, `gho_`, `ghu_`, `ghs_`, `github_pat_` |
| Linear | `lin_api_` |
| OpenRouter | `sk-or-v1-` |
| Slack Bot | `xoxb-` |
| Slack App | `xoxp-` |

Placeholder values are rejected: `your_key_here`, `TODO`, `CHANGEME`, `REPLACE_ME`, `xxx`, `placeholder`, and empty strings.

To bypass validation:

```bash
export PERGENTIC_SKIP_SECRET_VALIDATION=1
```

## Log Redaction

API keys and tokens are automatically redacted from logs before they are written. The redaction covers:

- Tokens matching the prefix patterns listed above (both standalone arguments and `--flag=VALUE` forms)
- `Authorization` request headers

Redacted values are replaced with `***REDACTED***`.

## Process Isolation

Agent subprocesses receive a filtered environment. Only these variables are passed:

```
PATH, HOME, SHELL, USER, LANG, LC_ALL,
TERM, NODE_ENV, TMPDIR, XDG_RUNTIME_DIR
```

All other environment variables — including API keys from your shell session — are stripped. Agent-specific credentials (e.g., `ANTHROPIC_API_KEY`) are passed via command-line flags by the agent implementations, not via environment inheritance.

## Editor Validation

When the `EDITOR` environment variable is used (for example, to edit schedule prompts), it is validated against an allowlist before use:

```
vi, vim, nvim, nano, emacs, code, subl,
mate, micro, hx, helix, kate, gedit
```

Shell metacharacters (`;`, `|`, `&`, `` ` ``, `$`, `(`, `)`, `{`, `}`, `[`, `]`, `<`, `>`, `!`, `#`, `~`, `*`, `?`) in `EDITOR` values cause the value to be rejected. Fallback in all rejection cases: `vi`.

## Daemon API

The HTTP status endpoint binds to `127.0.0.1` only, not `0.0.0.0`. It is not reachable from other machines on the network.

There is no authentication on the daemon API. Security relies entirely on the localhost binding and OS-level process ownership.

Rate limits per IP address:

| Endpoint | Limit | Window |
|----------|-------|--------|
| `GET /status` | 120 requests | 60 seconds |
| `POST /retry`, `POST /cancel` | 30 requests | 60 seconds |

Additional limits:

- Request body: 1 MB maximum
- Request timeout: 5 seconds (slow clients are disconnected)

## Git Safety

- Branch names derived from ticket titles are sanitized: invalid characters are removed or replaced, and length is enforced (slug max 50 characters, 7-character hash suffix appended on truncation to prevent collisions)
- PR template files are validated to ensure their resolved path stays within the repository root, blocking symlink traversal outside the repo
- SSH authentication is supported for git operations and uses the system's existing SSH agent

## File Permissions

All files written by pergentic that contain sensitive data use `0o600` mode:

| File | Mode |
|------|------|
| `~/.pergentic/daemon.pid` | 0o600 |
| `~/.pergentic/daemon.lock` | 0o600 |
| `~/.pergentic/.env` | 0o600 |
| `.pergentic/.env` (per-project) | 0o600 |
