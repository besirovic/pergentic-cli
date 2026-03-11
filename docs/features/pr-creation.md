# PR Creation

How pergentic creates pull requests after an agent completes work.

## Title

```yaml
pr:
  titleFormat: "feat: {taskTitle} [{taskId}]"    # Default
```

Variables: `{taskTitle}`, `{taskId}`.

When a ticket is routed to a specific agent or model via label routing, pergentic appends a suffix to the title: `[agent-name]` or `[agent-name/model-label]`.

For scheduled tasks, the title format is fixed: `chore(schedule): <schedule-name>`.

## Body

Three options for the PR body, checked in this order:

1. **Agent output**: If the agent writes `.pergentic/PR_BODY.md` in the worktree, its contents are used verbatim.
2. **Inline template**: `pr.bodyTemplate` in config. Supports `{taskTitle}` and `{taskId}` variables. Default: `Resolves {taskId}`.
3. **Template file**: `pr.templatePath` pointing to a file path relative to the repo root (max 10 KB).

If `pr.templatePath` is set but the file is not found, pergentic falls back to auto-detection. If the file exceeds 10 KB, it is truncated at a UTF-8 character boundary.

If none of the above apply, pergentic checks standard PR template locations in this order:

1. `.github/PULL_REQUEST_TEMPLATE.md`
2. `.github/pull_request_template.md`
3. `docs/PULL_REQUEST_TEMPLATE.md`
4. `docs/pull_request_template.md`
5. `PULL_REQUEST_TEMPLATE.md`
6. `pull_request_template.md`

If a `.github/PULL_REQUEST_TEMPLATE/` directory exists, the first `.md` file (alphabetically) is used.

Template paths that resolve outside the repository root via symlinks or path traversal are rejected.

## Labels

```yaml
pr:
  labels: ["ai-generated", "needs-review"]    # Default
```

## Reviewers

```yaml
pr:
  reviewers: ["alice", "bob"]    # GitHub usernames
```

Labels and reviewers are applied via separate GitHub API calls after PR creation. If either call fails, pergentic logs a warning with the PR URL and continues — the PR is still created.

## Post-PR Comments

After creating a PR, pergentic posts a comment on the original issue or ticket with:
- Task ID and title
- Commit message
- Files changed summary
- Link to the PR

Comments are posted to the source provider (Linear, GitHub, Jira) and also as a PR review comment on GitHub. Maximum comment length: 65,536 characters.

Post-PR comments are only posted for `new` task types, not for feedback or scheduled tasks.

## Commit Behavior

The agent's changes are staged and committed with an auto-generated message:

- New tickets: `feat: <title> [<taskId>]`
- Scheduled tasks: `chore(schedule): <title> [<taskId>]`

These files are excluded from the commit:

- `.claude-history.json`
- `.pergentic/PR_BODY.md`

## Duplicate PR Handling

Before creating a PR, pergentic checks the GitHub API for an existing open PR with the same head branch and base branch. If one is found, creation is skipped and the existing PR URL is returned.
