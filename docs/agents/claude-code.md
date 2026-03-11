# Claude Code Agent

Uses the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) to generate code changes.

## Command

```bash
claude -p <prompt> --output-format text --allowedTools <tools> [--model <name>]
```

## Default Tools

| Tool | Description |
|------|-------------|
| `Edit` | Edit existing files |
| `Write` | Create new files |
| `Read` | Read files |
| `Bash` | Execute shell commands |
| `Glob` | Search for files by pattern |
| `Grep` | Search file contents |
| `WebFetch` | Fetch web content |
| `WebSearch` | Search the web |

## Optional Tools

| Tool | Description |
|------|-------------|
| `NotebookEdit` | Edit Jupyter notebooks |
| `Agent` | Launch sub-agents |

Enable optional tools via `agentTools` in project config:

```yaml
agentTools:
  claude-code: [Edit, Write, Read, Bash, Glob, Grep, WebFetch, WebSearch, NotebookEdit, Agent]
```

When `agentTools` is set for `claude-code`, only the listed tools are passed to `--allowedTools`. When it is not set, all default tools are used.

## Configuration

All options are nested under the `claude` key in `.pergentic/config.yaml`:

```yaml
agent: claude-code

claude:
  instructions: "CLAUDE.md"       # Instruction file passed to agent (default: CLAUDE.md)
  agentTimeout: 3600              # Timeout in seconds, minimum 60 (default: 3600)
  maxCostPerTask: 5.00            # Maximum cost per task in USD (optional)
  allowedTools: [Edit, Read]      # Restrict tools (optional; overridden by agentTools)
  systemContext: "Follow TDD"     # Extra system context appended to the prompt (optional)
```

## Installation Check

```bash
claude --version    # Must exit 0 within 5 seconds
```
