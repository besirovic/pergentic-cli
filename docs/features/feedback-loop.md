# Feedback Loop

When someone leaves a review comment on a pergentic-generated PR, the daemon automatically dispatches the agent to address the feedback.

## How It Works

1. GitHub provider polls for new PR comments (every poll cycle, 2-minute window)
2. New comments create a feedback task with the highest queue priority (FEEDBACK = 1)
3. FeedbackExecutor pulls the existing branch into the worktree
4. Agent runs with the original task description, all previous feedback rounds, and the new comment
5. Changes are amended to the last commit and force-pushed

## Configuration

```yaml
feedback:
  listenTo:
    issueComments: true       # Process issue comments (default: true)
    reviewComments: true      # Process PR review comments (default: true)
    reviewRequests: false     # Process review request events (default: false)
  ignoreUsers:
    - "pergentic[bot]"        # Default: ["pergentic[bot]"]
  maxRounds: 5                # Maximum feedback iterations (default: 5)
```

## Feedback History

Each task maintains a feedback history file (`.claude-history.json`) in the git worktree. It is created by the initial `TicketExecutor` run and updated by each subsequent `FeedbackExecutor` run.

```json
{
  "taskId": "abc123",
  "originalDescription": "Implement feature X",
  "feedbackRounds": [
    {
      "round": 1,
      "comment": "Add error handling for the edge case",
      "file": "src/handler.ts",
      "line": 42,
      "timestamp": "2025-01-15T10:30:00Z"
    }
  ]
}
```

The agent prompt includes all previous rounds when processing new feedback:

```
You're working on task abc123: Implement feature X

Previous feedback applied:
  Round 1: "Add error handling for the edge case"

New feedback (Round 2):
  "The error message should include the original input"
  This comment is on file src/handler.ts, line 55.

Apply the requested changes without regressing on previous fixes.
```

If no history file is found in the worktree (e.g., the worktree was recreated), a new one is initialized from the task payload before the agent runs.

## Git Behavior

Before running the agent, `FeedbackExecutor` pulls the latest state of the branch:

- If the pull fails due to a merge conflict, network error, or rejected push, the task is marked failed with a recovery message describing what to do manually
- After the agent succeeds, changes are amended into the last commit and force-pushed to the branch

## Limits

| Setting | Default | Description |
|---------|---------|-------------|
| `feedback.maxRounds` | 5 | Maximum feedback iterations per task |
| Comment poll window | 120 seconds | Comments older than 2 minutes at poll time are not picked up |
| Queue priority | FEEDBACK = 1 | Feedback tasks run before new tickets and retries |
