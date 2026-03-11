# Global Configuration

Location: `~/.pergentic/config.yaml`

Controls daemon-wide behavior across all projects.

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `pollInterval` | number | `30` | Seconds between polling cycles. Minimum: 5. |
| `maxConcurrent` | number | `2` | Maximum tasks running simultaneously. Minimum: 1. |
| `statusPort` | number | `7890` | Port for the daemon HTTP status endpoint (localhost only). |

## Notifications

Configure how you get notified about task outcomes.

### Slack Notifications

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `notifications.slack.webhook` | string | — | Slack incoming webhook URL. |
| `notifications.slack.on.taskCompleted` | boolean | `false` | Notify on task completion. |
| `notifications.slack.on.taskFailed` | boolean | `false` | Notify on task failure. |
| `notifications.slack.on.prCreated` | boolean | `false` | Notify on PR creation. |

### Discord Notifications

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `notifications.discord.webhook` | string | — | Discord webhook URL. |
| `notifications.discord.on.taskCompleted` | boolean | `false` | Notify on task completion. |
| `notifications.discord.on.taskFailed` | boolean | `false` | Notify on task failure. |
| `notifications.discord.on.prCreated` | boolean | `false` | Notify on PR creation. |

### Desktop Notifications

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `notifications.desktop.on.taskCompleted` | boolean | `false` | Desktop notification on task completion. |
| `notifications.desktop.on.taskFailed` | boolean | `false` | Desktop notification on task failure. |
| `notifications.desktop.on.prCreated` | boolean | `false` | Desktop notification on PR creation. |

Desktop notifications use `osascript` on macOS and `notify-send` on Linux.

## Remotes

Monitor daemon instances on other machines via SSH tunnel.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `remotes.<name>.host` | string | — | Hostname or IP. Alphanumeric, dots, and hyphens only. Max 253 chars. |
| `remotes.<name>.port` | number | `7890` | Status port on the remote host. Range: 1–65535. |

## Example

```yaml
pollInterval: 60
maxConcurrent: 4
statusPort: 7890

notifications:
  slack:
    webhook: https://hooks.slack.com/services/T.../B.../xxx
    on:
      taskCompleted: true
      taskFailed: true
      prCreated: true
  discord:
    webhook: https://discord.com/api/webhooks/...
    on:
      taskFailed: true
  desktop:
    on:
      taskFailed: true

remotes:
  staging:
    host: staging.example.com
    port: 7890
```
