# Linear Provider

Polls Linear for tickets and updates their status as work progresses.

## Prerequisites

- Linear API key (prefix: `lin_api_`)
- Linear team ID (the team key, e.g., `ENG`)

## Configuration

In `.pergentic/.env`:
```bash
PERGENTIC_LINEAR_API_KEY=lin_api_xxxxx
```

In `.pergentic/config.yaml`:
```yaml
linearTeamId: ENG

linear:
  triggers:
    onInProgress: true    # Poll issues in "In Progress" status (default: true)
    onInReview: false     # Poll issues in "In Review" status (default: false)
  updateStatus:
    afterPR: "In Review"  # Set status after PR is created (default: "In Review")
    afterMerge: "Done"    # Set status after PR is merged (default: "Done")
```

## Polling Behavior

The provider queries the Linear GraphQL API for issues matching:
- Team: configured `linearTeamId`
- Status: `"In Progress"` (if `onInProgress` is true)

Note: the `onInReview` trigger is defined in the schema but the current polling query only filters on `"In Progress"`. The trigger flags are validated at config load time but only `onInProgress` drives the poll filter in the current implementation.

Max results: 20 per poll.

Labels on Linear issues are extracted and used for agent routing (via `agentLabels` config) and conventional commit type mapping.

## Status Transitions

When a task completes, `onComplete` is called with the result status:

```
completed  → issue state set to "In Review"  (configurable via linear.updateStatus.afterPR)
any other  → issue state set to "In Progress" (task returned to queue)
```

The `afterMerge` value (`"Done"`) is stored in config but is not triggered by the daemon directly — it depends on a PR merge webhook or manual action.

State resolution works by name: the provider looks up the state ID from Linear using a GraphQL query, then updates the issue. State IDs are cached in an LRU cache (256 entries) keyed by `issueId:stateName` to reduce API calls.

## Task ID Format

Linear tasks use the identifier format `linear-TEAM-123` (e.g., `linear-ENG-42`). Multi-agent dispatch appends the agent name: `linear-ENG-42-claude-code`.

## Comment Posting

After a PR is created, pergentic posts a comment on the Linear issue via the `commentCreate` GraphQL mutation. The comment includes the commit message, files changed, and PR URL.
