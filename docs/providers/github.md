# GitHub Provider

Polls GitHub for assigned issues and PR review comments.

## Prerequisites

- GitHub personal access token or fine-grained PAT
- Accepted token prefixes: `ghp_`, `github_pat_`
- Token must have `repo` scope

## Configuration

In `.pergentic/.env`:
```bash
PERGENTIC_GITHUB_TOKEN=ghp_xxxxx
```

In `.pergentic/config.yaml`:
```yaml
repo: git@github.com:owner/repo.git
# or
repo: https://github.com/owner/repo.git
```

## What It Polls

### Issues

- Open issues assigned to any user (`assignee=*`) in the configured repo
- Pull requests are excluded (the GitHub issues API returns PRs; the provider skips entries that have a `pull_request` field)
- Pagination: 20 issues per page

### PR Comments (Feedback)

- Polls all issue comments updated in the last 2 minutes (`COMMENT_POLL_WINDOW_MS = 120,000 ms`)
- Filters to comments that have a `pull_request_url` field (i.e., comments on PRs, not plain issues)
- Pagination: 50 comments per page

## Feedback Tasks

When a new PR comment is detected, a feedback task is created with priority `FEEDBACK` (1) — the highest priority in the queue. The `FeedbackExecutor` then runs the agent on the existing branch with the comment content as input.

Note: the `feedback.ignoreUsers` config field (default: `["pergentic[bot]"]`) is defined in the schema and enforced by the `FeedbackExecutor`, not inside the `GitHubProvider` poll loop itself.

## PR Creation

After an agent completes work on a ticket:

1. Changes are committed and pushed to a new branch
2. A PR is created via the GitHub REST API with:
   - Title from `pr.titleFormat` (default: `"feat: {taskTitle} [{taskId}]"`)
   - Labels from `pr.labels` (default: `["ai-generated", "needs-review"]`)
   - Reviewers from `pr.reviewers` (if configured)
3. A comment is posted on the original issue linking to the PR

## URL Parsing

The `repo` field supports both formats:
- SSH: `git@github.com:owner/repo.git`
- HTTPS: `https://github.com/owner/repo.git`

Owner and repo name are extracted automatically. If parsing fails, the provider logs a warning and returns no tasks for that poll cycle rather than crashing.

## onComplete

The GitHub provider's `onComplete` is a no-op. GitHub issues are closed via PR merge; no status update is made by the daemon.

## Token Validation

The token is validated at load time against the `ghp_` prefix. Tokens with other valid GitHub prefixes (`gho_`, `ghu_`, `ghs_`) are accepted by the redaction and secret storage logic but will fail the prefix check during `loadSecrets` unless `PERGENTIC_SKIP_SECRET_VALIDATION=1` is set. Use `github_pat_` fine-grained PATs or `ghp_` classic PATs.
