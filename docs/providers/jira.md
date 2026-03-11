# Jira Provider

**Status: Incomplete.** Configuration fields are validated and credential storage works, but the provider does not poll for issues.

## What Works

- Configuration fields (`jiraDomain`, `jiraEmail`, `jiraApiToken`) are validated by the Zod schema at startup
- Credentials are stored in `.pergentic/.env` and loaded via the standard secret resolution chain
- Comment posting to Jira issues is implemented (`postJiraComment` in `src/core/comments.ts`) and is called after a task completes if `source === "jira"`
- Domain validation enforces a bare hostname format (e.g., `mycompany.atlassian.net`), not a full URL

## What Doesn't Work

- Issue polling is not implemented — there is no `JiraProvider` class
- The poller does not instantiate any Jira provider
- Status transitions are not implemented
- Tasks cannot originate from Jira in the current release

## Configuration

In `.pergentic/.env`:
```bash
PERGENTIC_JIRA_API_TOKEN=xxxxx
PERGENTIC_JIRA_EMAIL=you@example.com
PERGENTIC_JIRA_DOMAIN=yourcompany.atlassian.net
```

These values are stored and validated at startup but are only used if a task with `source: "jira"` reaches `postTaskComments`. That path is not reachable through normal operation since no provider creates Jira-sourced tasks.

## Comment API

When implemented, comments will be posted using the Jira REST API v3 with Basic auth:

```
POST https://{jiraDomain}/rest/api/3/issue/{issueKey}/comment
Authorization: Basic base64(email:apiToken)
```

The comment body uses the Atlassian Document Format (ADF), not plain Markdown.

## Planned

Issue polling and status updates are planned for a future release. The schema and credential infrastructure are in place; the provider class and poller integration are not yet written.
