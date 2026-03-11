# Agents

Pergentic delegates code generation to external coding agents. Four agents are supported.

## Available Agents

| Agent | Command | Default |
|-------|---------|---------|
| `claude-code` | `claude` | Yes |
| `codex` | `codex` | No |
| `aider` | `aider` | No |
| `opencode` | `opencode` | No |

## Selection

The default agent is set in project config:

```yaml
agent: claude-code
```

List additional agents available to the project:

```yaml
configuredAgents: [claude-code, codex]
```

## Label-Based Routing

Route tickets to different agents based on their labels:

```yaml
agentLabels:
  backend: [claude-code]
  frontend: [aider]
  data: [codex]
```

When a ticket has a label matching a key in `agentLabels`, it is dispatched to the agent(s) listed for that label instead of the default.

## Model Overrides

Override which model an agent uses based on ticket labels:

```yaml
modelLabels:
  complex:
    claude-code: claude-sonnet-4-20250514
  quick-fix:
    claude-code: claude-haiku-4-5-20251001
```

## API Provider Routing

Route agents to different API providers:

```yaml
agentProviders:
  claude-code: anthropic
  codex: openai
  aider: openrouter
```

Options: `anthropic`, `openai`, `openrouter`, `env` (use the agent's default environment variable).

## Tool Restrictions

Limit which tools an agent can use:

```yaml
agentTools:
  claude-code: [Edit, Write, Read, Bash, Glob, Grep]
```

Available tools vary by agent. See individual agent pages.

## Timeout

Default agent timeout: 3600 seconds (1 hour). Minimum: 60 seconds.

```yaml
claude:
  agentTimeout: 1800   # 30 minutes
```

## Cost Limit

Set a maximum cost per task (USD):

```yaml
claude:
  maxCostPerTask: 5.00
```

## Version Check

Each agent's CLI is checked at startup with `<agent> --version` (5-second timeout). If the agent is not installed or the check times out, the agent is marked unavailable.

## Argument Limit

All agents have a 64 KB limit on total command argument length. Exceeding this limit raises an error before the agent is spawned.
