# Notifications

Get notified when tasks complete, fail, or produce PRs.

## Channels

### Slack

```yaml
# In global config (~/.pergentic/config.yaml)
notifications:
  slack:
    webhook: https://hooks.slack.com/services/T.../B.../xxx
    on:
      taskCompleted: true
      taskFailed: true
      prCreated: true
```

Uses Slack incoming webhooks. This is separate from the Slack provider (which uses bot/app tokens for triggering tasks).

If the project config includes a `slackBotToken` and a matching channel ID under `slack.channels`, that channel receives the notification via the Slack Bot API instead of the webhook:

```yaml
# In project config (.pergentic/config.yaml)
slackBotToken: "xoxb-..."
slack:
  channels:
    taskCompleted: C01234567
    taskFailed: C01234567
    prCreated: C09876543
```

When a bot token and channel ID are both present for an event type, the webhook is not used for that event. When either is absent, the global webhook is used as a fallback.

### Discord

```yaml
notifications:
  discord:
    webhook: https://discord.com/api/webhooks/...
    on:
      taskCompleted: false
      taskFailed: true
      prCreated: true
```

### Desktop

```yaml
notifications:
  desktop:
    on:
      taskCompleted: false
      taskFailed: true
      prCreated: false
```

Desktop notifications use:
- **macOS**: `osascript` (native notification center)
- **Linux**: `notify-send`

Other platforms are not supported. Failures are logged at debug level and do not affect task execution.

## Event Types

| Event | Description |
|-------|-------------|
| `taskCompleted` | Agent finished and changes were committed |
| `taskFailed` | Agent failed or verification exhausted retries |
| `prCreated` | Pull request was created on GitHub |

All events default to `false`. Enable only the ones you want.

## Scope

Notifications are resolved by merging project and global config. Project-level settings take precedence per channel:

- **Global** (`~/.pergentic/config.yaml`) — applies to all projects
- **Project** (`.pergentic/config.yaml`) — overrides global settings for that project

If neither level defines a channel, that channel is skipped. All configured channels fire concurrently; a failure in one does not block others. Failures are logged at `warn` level.

## Message Format

Slack and Discord messages use dialect-specific markup:

- **taskCompleted / prCreated**: task ID, title, project, PR link (if any), duration, estimated cost
- **taskFailed**: task ID, title, project, retry count (if any), error message, retry command (`pergentic retry <taskId>`)

Desktop notifications use plain text with the same fields.
