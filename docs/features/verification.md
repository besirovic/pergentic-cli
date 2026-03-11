# Verification

Runs shell commands after an agent completes to check that the generated code is correct.

## How It Works

1. Agent finishes code generation
2. Each verification command runs in the worktree in order, stopping at the first failure
3. If any command fails, the agent is re-invoked with the error output
4. This repeats up to `maxRetries` times

## Configuration

```yaml
verification:
  commands:
    - "npm test"
    - "npm run lint"
  maxRetries: 3           # Default: 3, range: 0-20
  commandTimeout: 300     # Default: 300 seconds, minimum: 10
```

## Behavior

- Commands run via `sh -c` in the task's git worktree
- Each command gets its own timeout (default: 300 seconds)
- On timeout: SIGTERM is sent first, then SIGKILL after 10 seconds
- Error output is truncated to the last 3000 graphemes before being passed back to the agent
- Only whitelisted environment variables are available to commands: `PATH`, `HOME`, `SHELL`, `USER`, `LANG`, `LC_ALL`, `TERM`, `NODE_ENV`, `TMPDIR`, `XDG_RUNTIME_DIR`, plus any agent-specific overrides

## Retry Loop

The loop runs from attempt `0` through `maxRetries` inclusive. On each attempt:

1. All verification commands run in sequence
2. If all pass, verification succeeds
3. If one fails, the error output is captured
4. If this is the last attempt (`maxRetries` exhausted), the task is marked failed and a comment is posted to the PR
5. Otherwise, the agent is re-invoked with a prompt containing the failed command name, attempt number, and truncated error output
6. The agent must fix the code so the command passes — it must not modify the verification command itself

If the agent exits with a non-zero code during a fix attempt, the error is logged but the loop continues to re-run verification.

## Process Safety

- Processes receive SIGTERM first for graceful shutdown
- If still running after 10 seconds, SIGKILL is sent
- Orphaned child processes are killed when the parent daemon exits via a `process.on("exit")` handler
- If a task is cancelled mid-fix, the fix agent is sent SIGTERM then SIGKILL and verification returns failure
