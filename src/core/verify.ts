import { spawn } from "node:child_process";
import { logger } from "../utils/logger";
import { buildSafeEnv } from "../utils/process";
import type { AgentCommand } from "../agents/types";
import type { SpawnResult } from "../utils/process";

export interface VerificationResult {
  success: boolean;
  failedCommand?: string;
  output?: string;
}

interface ExecResult {
  success: boolean;
  output: string;
}

export function execCommand(
  cmd: string,
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", cmd], {
      cwd,
      env: buildSafeEnv(env),
      stdio: ["ignore", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];

    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk));

    child.on("close", (code) => {
      resolve({
        success: code === 0,
        output: Buffer.concat(chunks).toString("utf-8").trim(),
      });
    });

    child.on("error", (err) => {
      resolve({
        success: false,
        output: err.message,
      });
    });
  });
}

export async function runVerificationCommands(
  worktreePath: string,
  commands: string[],
  env: Record<string, string | undefined>,
): Promise<VerificationResult> {
  for (const cmd of commands) {
    logger.info({ cmd, cwd: worktreePath }, "Running verification command");

    const result = await execCommand(cmd, worktreePath, env);

    if (!result.success) {
      return {
        success: false,
        failedCommand: cmd,
        output: result.output,
      };
    }

    logger.info({ cmd }, "Verification command passed");
  }

  return { success: true };
}

export function buildVerificationFixPrompt(
  failedCommand: string,
  output: string,
  attempt: number,
  maxAttempts: number,
): string {
  return [
    "A verification command failed. Please fix the issue.",
    "",
    `**Failed command:** \`${failedCommand}\``,
    `**Attempt:** ${attempt} of ${maxAttempts}`,
    "",
    "**Error output:**",
    "```",
    output.length > 3000 ? `[Output truncated to last 3000 chars]\n${output.slice(-3000)}` : output,
    "```",
    "",
    "Fix the code so this command passes. Do not modify the verification command itself.",
  ].join("\n");
}

import type { ChildProcess } from "node:child_process";

export interface AgentHandle {
  process: ChildProcess;
  result: Promise<SpawnResult>;
}

const SIGKILL_DELAY_MS = 10_000;

export function spawnAgentAndWait(
  agentCmd: AgentCommand,
  cwd: string,
  env: Record<string, string | undefined>,
  timeoutMs?: number,
): AgentHandle {
  const child = spawn(agentCmd.command, agentCmd.args, {
    cwd,
    env: buildSafeEnv(env),
    stdio: ["ignore", "pipe", "pipe"],
  });

  const MAX_OUTPUT = 8192;
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutLen = 0;
  let stderrLen = 0;
  let stdoutTruncated = false;
  let stderrTruncated = false;
  let timedOut = false;

  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutChunks.push(chunk);
    stdoutLen += chunk.length;
    while (stdoutLen > MAX_OUTPUT && stdoutChunks.length > 1) {
      stdoutLen -= stdoutChunks.shift()!.length;
      stdoutTruncated = true;
    }
    if (stdoutChunks.length === 1 && stdoutLen > MAX_OUTPUT) {
      const single = stdoutChunks[0];
      stdoutChunks[0] = single.subarray(single.length - MAX_OUTPUT);
      stdoutLen = MAX_OUTPUT;
      stdoutTruncated = true;
    }
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk);
    stderrLen += chunk.length;
    while (stderrLen > MAX_OUTPUT && stderrChunks.length > 1) {
      stderrLen -= stderrChunks.shift()!.length;
      stderrTruncated = true;
    }
    if (stderrChunks.length === 1 && stderrLen > MAX_OUTPUT) {
      const single = stderrChunks[0];
      stderrChunks[0] = single.subarray(single.length - MAX_OUTPUT);
      stderrLen = MAX_OUTPUT;
      stderrTruncated = true;
    }
  });

  let termTimer: ReturnType<typeof setTimeout> | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;

  if (timeoutMs) {
    termTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, SIGKILL_DELAY_MS);
    }, timeoutMs);
  }

  const result = new Promise<SpawnResult>((resolve) => {
    child.on("close", (code) => {
      if (termTimer) clearTimeout(termTimer);
      if (killTimer) clearTimeout(killTimer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();
      if (timedOut) {
        resolve({
          exitCode: 1,
          stdout,
          stderr: `Agent timed out after ${Math.floor((timeoutMs ?? 0) / 1000)}s\n${stderr}`,
        });
      } else {
        resolve({
          exitCode: code ?? 1,
          stdout: stdoutTruncated ? `[Output truncated to last 8KB]\n${stdout}` : stdout,
          stderr: stderrTruncated ? `[Output truncated to last 8KB]\n${stderr}` : stderr,
        });
      }
    });

    child.on("error", (err) => {
      if (termTimer) clearTimeout(termTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        exitCode: 1,
        stdout: "",
        stderr: err.message,
      });
    });
  });

  return { process: child, result };
}
