# Branch Naming

Controls how pergentic names branches for generated PRs.

## Template

```yaml
branching:
  template: "{taskId}-{title}"    # Default
```

The template must contain `{taskId}`. Available variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `{taskId}` | Task identifier | `ENG-123` |
| `{title}` | Task title (slugified) | `add-user-auth` |
| `{source}` | Task source | `linear`, `github` |
| `{type}` | Conventional commit type | `feat`, `fix` |
| `{project}` | Project name | `backend` |
| `{agent}` | Agent name | `claude-code` |
| `{date}` | ISO date | `2025-01-15` |
| `{timestamp}` | Unix seconds | `1705312800` |
| `{shortHash}` | 7-char SHA256 of title | `a3f7b2c` |

## Examples

```yaml
# Default
branching:
  template: "{taskId}-{title}"
# → ENG-123-add-user-auth

# With type prefix
branching:
  template: "{type}/{taskId}-{title}"
# → feat/ENG-123-add-user-auth
```

## Sanitization

- Maximum slug length: 50 characters (42 chars + 7-char hash suffix when truncated)
- Characters matching `[\s~^:?*\[\]\\]` are replaced with hyphens
- Consecutive hyphens are collapsed
- Consecutive slashes are collapsed
- Leading and trailing hyphens, dots, and slashes are stripped
- `.lock` suffix is stripped
- If the template produces an empty slug, a fallback of `branch-<hash>` is used

## Type Mapping

The `{type}` variable is resolved from ticket labels using conventional commit conventions. Default mappings:

| Type | Labels |
|------|--------|
| `feat` | feature, enhancement, improvement, story, user-story |
| `fix` | bug, bugfix, fix, defect, incident, hotfix, regression |
| `docs` | documentation, docs |
| `refactor` | refactor, refactoring, cleanup, tech-debt |
| `test` | test, testing, tests |
| `perf` | performance, perf |
| `ci` | ci, ci/cd, pipeline |
| `chore` | chore, maintenance, dependencies |
| `style` | style, formatting, lint |
| `build` | build |

Override with `branching.typeMap`:

```yaml
branching:
  typeMap:
    feature: feat
    bugfix: fix
```

Label prefix stripping: prefixes like `type:`, `kind:`, `category:` are removed before matching.

If no label matches, the fallback depends on task type:

| Task type | Fallback |
|-----------|----------|
| `new` | `feat` |
| `feedback` | `fix` |
| `retry` | `feat` |
| `scheduled` | `chore` |
