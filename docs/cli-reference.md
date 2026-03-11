# CLI Reference

## Global Flags
| Flag | Description |
|------|-------------|
| `--verbose` | Enable verbose logging |
| `--version` | Show version |

## Daemon Commands

### `pergentic start`
Start the daemon in the background.
```bash
pergentic start
```

### `pergentic stop`
Stop the daemon gracefully.
```bash
pergentic stop
```

### `pergentic restart`
Stop and restart the daemon.
```bash
pergentic restart
```

### `pergentic status`
Show daemon status.
```bash
pergentic status
pergentic status --remote <name>   # Check remote daemon via SSH tunnel
```
| Flag | Description |
|------|-------------|
| `--remote <name>` | Query a remote daemon configured in global config |

### `pergentic dashboard`
Launch the TUI monitoring dashboard. Updates every 1s. Stops after 3 consecutive fetch failures.
```bash
pergentic dashboard
```

## Project Commands

### `pergentic init [path]`
Interactive setup wizard. Creates `.pergentic/config.yaml` and `.pergentic/.env`. Registers project in `~/.pergentic/projects.yaml`. Default path: current directory.
```bash
pergentic init
pergentic init /path/to/repo
```

### `pergentic add [path]`
Register an existing project (already has `.pergentic/` directory). Default path: current directory.
```bash
pergentic add
pergentic add /path/to/repo
```

### `pergentic remove [path]`
Unregister a project. Does not delete project files. Default path: current directory.
```bash
pergentic remove
```

### `pergentic list`
Show all registered projects.
```bash
pergentic list
```

## Task Commands

### `pergentic history [taskId]`
View task history. Without taskId, shows recent tasks. With taskId, shows details for that task.
```bash
pergentic history
pergentic history --project myapp
pergentic history -n 50
pergentic history <taskId>
```
| Flag | Description |
|------|-------------|
| `--project <name>` | Filter by project name |
| `-n, --limit <count>` | Number of entries to show (default: 20) |

### `pergentic retry <taskId>`
Retry a failed task.
```bash
pergentic retry abc123
```

### `pergentic cancel <taskId>`
Cancel a running task.
```bash
pergentic cancel abc123
```

## Log Commands

### `pergentic logs`
View daemon logs.
```bash
pergentic logs
pergentic logs -f
pergentic logs --project myapp -n 100
```
| Flag | Description |
|------|-------------|
| `--project <name>` | Filter logs by project |
| `-n, --lines <count>` | Number of lines to show (default: 50) |
| `-f, --follow` | Follow log output (tail -f behavior) |

## Schedule Commands

### `pergentic schedule add [path]`
Create a scheduled task interactively. Default path: current directory.
```bash
pergentic schedule add
```

### `pergentic schedule list [path]`
List all scheduled tasks for a project.
```bash
pergentic schedule list
```

### `pergentic schedule remove <name>`
Remove a scheduled task by name.
```bash
pergentic schedule remove daily-review
pergentic schedule remove daily-review --project /path/to/repo
```
| Flag | Description |
|------|-------------|
| `--project <path>` | Project path (default: current directory) |

### `pergentic schedule pause <name>`
Pause a scheduled task.
```bash
pergentic schedule pause daily-review
```
| Flag | Description |
|------|-------------|
| `--project <path>` | Project path (default: current directory) |

### `pergentic schedule resume <name>`
Resume a paused scheduled task.
```bash
pergentic schedule resume daily-review
```
| Flag | Description |
|------|-------------|
| `--project <path>` | Project path (default: current directory) |

## Service Commands

### `pergentic service install`
Generate and install a system service configuration. On Linux, generates a systemd unit file. On macOS, generates a launchd plist.
```bash
pergentic service install
```
