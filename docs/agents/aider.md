# Aider Agent

Uses [Aider](https://aider.chat) to generate code changes.

## Command

```bash
aider --message <prompt> --yes [--model <name>]
```

The `--yes` flag auto-confirms all prompts so aider runs non-interactively.

## Tools

Aider manages its own tool selection internally. `agentTools` configuration has no effect for this agent.

## Configuration

```yaml
agent: aider
```

## Installation Check

```bash
aider --version    # Must exit 0 within 5 seconds
```
