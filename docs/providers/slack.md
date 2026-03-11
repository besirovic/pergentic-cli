# Slack Provider

Trigger tasks by mentioning pergentic in Slack channels.

## Prerequisites

- Slack Bot Token (prefix: `xoxb-`) — used to identify the bot
- Slack App Token (prefix: `xoxp-`) — used to open the Socket Mode WebSocket connection via `apps.connections.open`

Socket Mode must be enabled in your Slack app settings.

## Configuration

In `.pergentic/.env`:
```bash
PERGENTIC_SLACK_BOT_TOKEN=xoxb-xxxxx
PERGENTIC_SLACK_APP_TOKEN=xoxp-xxxxx
```

In `.pergentic/config.yaml`:
```yaml
slack:
  channels:
    C01234567: my-project
    C89012345: other-project
```

The `channels` map binds Slack channel IDs to project names. When a mention arrives in a channel listed here and no `in <project>` directive is given, that channel's project receives the task.

## How It Works

The Slack provider uses Socket Mode — an outbound WebSocket connection from your machine to Slack. No public URL or inbound webhook is required.

On each poll cycle, if the WebSocket is not connected, the provider calls `apps.connections.open` to get a URL and establishes the connection. Events received on the WebSocket are buffered in `pendingTasks`. When `poll()` is called, the buffer is drained and returned as tasks.

If the connection drops, the provider reconnects on the next poll cycle. Stale events from a previous connection are cleared on reconnect.

## Mention Syntax

```
@pergentic <task description>
@pergentic in <project> <task description>
```

- Bot mention tokens (`<@U...>`) are stripped from the text before parsing.
- If `in <project>` is present, the named project receives the task.
- If absent, the `slack.channels` map is consulted using the channel ID.
- Task titles are truncated to 100 characters; the full text is used as the description.

## Notifications vs Triggers

Slack serves two distinct purposes in pergentic:

1. **Trigger**: mentioning `@pergentic` creates a new task (this provider, configured per project).
2. **Notifications**: task completion and failure alerts sent to a webhook URL (configured in global `notifications.slack`).

These are separate configurations. The trigger uses `xoxb-`/`xoxp-` tokens and Socket Mode. Notifications use a plain webhook URL and do not require the Slack provider to be configured.

## onComplete

Currently a no-op. The provider logs task completion but does not post a reply to the Slack thread. Thread reply support is planned.

## Limitations

- Thread replies are not supported as triggers. Only top-level `app_mention` events create tasks.
- The provider does not deduplicate messages across reconnects — stale events are cleared on reconnect, so any events buffered during a connection gap are lost.
- There is no `feedback` loop for Slack-originated tasks. Follow-up messages do not create feedback tasks.
