import { spawn } from "node:child_process";
import { logger } from "../utils/logger";
import type { AgentCommand } from "../agents/types";

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
      env: { ...process.env, ...env },
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
    output.slice(-3000),
    "```",
    "",
    "Fix the code so this command passes. Do not modify the verification command itself.",
  ].join("\n");
}

export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function spawnAgentAndWait(
  agentCmd: AgentCommand,
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(agentCmd.command, agentCmd.args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const MAX_OUTPUT = 8192;
    let stdoutLen = 0;
    let stderrLen = 0;

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      stdoutLen += chunk.length;
      while (stdoutLen > MAX_OUTPUT && stdoutChunks.length > 1) {
        stdoutLen -= stdoutChunks.shift()!.length;
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      stderrLen += chunk.length;
      while (stderrLen > MAX_OUTPUT && stderrChunks.length > 1) {
        stderrLen -= stderrChunks.shift()!.length;
      }
    });

    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8").trim(),
        stderr: Buffer.concat(stderrChunks).toString("utf-8").trim(),
      });
    });

    child.on("error", (err) => {
      resolve({
        exitCode: 1,
        stdout: "",
        stderr: err.message,
      });
    });
  });
}
