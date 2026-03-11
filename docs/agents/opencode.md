# OpenCode Agent

Uses [OpenCode](https://github.com/opencode-ai/opencode) to generate code changes.

## Command

```bash
opencode run <prompt> --tool <tool1> --tool <tool2> ... [--model <name>]
```

Each tool is passed as a separate `--tool` flag.

## Default Tools

| Tool | Description |
|------|-------------|
| `edit` | Edit existing files |
| `write` | Create new files |
| `read` | Read files |
| `bash` | Execute shell commands |
| `glob` | Search for files by pattern |
| `grep` | Search file contents |

## Optional Tools

| Tool | Description |
|------|-------------|
| `web_fetch` | Fetch web content |

Enable optional tools via `agentTools` in project config:

```yaml
agentTools:
  opencode: [edit, write, read, bash, glob, grep, web_fetch]
```

When `agentTools` is set for `opencode`, only the listed tools are passed to the command. When it is not set, all default tools are used.

## Configuration

```yaml
agent: opencode
```

## Installation Check

```bash
opencode --version    # Must exit 0 within 5 seconds
```
