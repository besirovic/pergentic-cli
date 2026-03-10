import { spawn, type SpawnOptions } from "node:child_process";

/** Delay between SIGTERM and SIGKILL when killing agent processes. */
export const SIGKILL_DELAY_MS = 10_000;

export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SpawnOpts {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeout?: number;
}

const WHITELISTED_ENV_KEYS = [
  "PATH",
  "HOME",
  "SHELL",
  "USER",
  "LANG",
  "LC_ALL",
  "TERM",
  "NODE_ENV",
  "TMPDIR",
  "XDG_RUNTIME_DIR",
];

export function buildSafeEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  const safe: Record<string, string | undefined> = {};
  for (const key of WHITELISTED_ENV_KEYS) {
    if (process.env[key] !== undefined) {
      safe[key] = process.env[key];
    }
  }
  return { ...safe, ...overrides };
}

const MAX_OUTPUT = 8192;
const TRUNCATION_PREFIX = "[Output truncated to last 8KB]\n";

function capBuffer(
  chunks: Buffer[],
  len: number,
): { chunks: Buffer[]; len: number; truncated: boolean } {
  let truncated = false;
  while (len > MAX_OUTPUT && chunks.length > 1) {
    len -= chunks.shift()!.length;
    truncated = true;
  }
  if (chunks.length === 1 && len > MAX_OUTPUT) {
    const single = chunks[0];
    chunks[0] = single.subarray(single.length - MAX_OUTPUT);
    len = MAX_OUTPUT;
    truncated = true;
  }
  return { chunks, len, truncated };
}

export function spawnAsync(
  command: string,
  args: string[],
  opts: SpawnOpts = {},
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const spawnOpts: SpawnOptions = {
      cwd: opts.cwd,
      env: buildSafeEnv(opts.env),
      stdio: ["ignore", "pipe", "pipe"],
    };

    const child = spawn(command, args, spawnOpts);

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
      const capped = capBuffer(stdoutChunks, stdoutLen);
      stdoutLen = capped.len;
      if (capped.truncated) stdoutTruncated = true;
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      stderrLen += chunk.length;
      const capped = capBuffer(stderrChunks, stderrLen);
      stderrLen = capped.len;
      if (capped.truncated) stderrTruncated = true;
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (opts.timeout) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, opts.timeout);
    }

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on("close", (exitCode) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Process timed out after ${opts.timeout}ms`));
        return;
      }
      const stdout = Buffer.concat(stdoutChunks).toString();
      const stderr = Buffer.concat(stderrChunks).toString();
      resolve({
        exitCode: exitCode ?? 1,
        stdout: stdoutTruncated ? TRUNCATION_PREFIX + stdout : stdout,
        stderr: stderrTruncated ? TRUNCATION_PREFIX + stderr : stderr,
      });
    });
  });
}
