# Codex Agent

Uses the [Codex CLI](https://github.com/openai/codex) to generate code changes.

## Command

```bash
codex --quiet <prompt> [--full-auto | --auto-edit] [--model <name>]
```

## Automation Flags

The automation flag is selected based on the active tool set:

| Condition | Flag |
|-----------|------|
| `shell`, `file_edit`, and `file_write` all present | `--full-auto` |
| `file_edit` or `file_write` present (without `shell`) | `--auto-edit` |
| Neither condition met | No flag |

## Default Tools

| Tool | Description |
|------|-------------|
| `shell` | Execute shell commands |
| `file_read` | Read files |
| `file_edit` | Edit existing files |
| `file_write` | Create new files |

## Optional Tools

| Tool | Description |
|------|-------------|
| `web_search` | Search the web |

Enable optional tools via `agentTools` in project config:

```yaml
agentTools:
  codex: [shell, file_read, file_edit, file_write, web_search]
```

When `agentTools` is set for `codex`, only the listed tools are used when determining the automation flag. When it is not set, all default tools are active.

## Configuration

```yaml
agent: codex
```

## Installation Check

```bash
codex --version    # Must exit 0 within 5 seconds
```
