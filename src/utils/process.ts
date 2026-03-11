import { basename } from "node:path";
import { spawn, type SpawnOptions } from "node:child_process";

/** Delay between SIGTERM and SIGKILL when killing agent processes. */
export const SIGKILL_DELAY_MS = 10_000;

const ALLOWED_EDITORS = new Set([
  "vi",
  "vim",
  "nvim",
  "nano",
  "emacs",
  "code",
  "subl",
  "mate",
  "micro",
  "hx",
  "helix",
  "kate",
  "gedit",
]);

const SHELL_METACHAR_RE = /[;|&`$(){}[\]<>!#~*?\n\r]/;

/**
 * Resolve and validate the EDITOR env var, falling back to 'vi' if the value
 * is missing, not in the allow-list, or contains shell metacharacters.
 */
export function resolveEditor(): string {
  const raw = process.env.EDITOR;
  if (!raw) return "vi";

  if (SHELL_METACHAR_RE.test(raw)) {
    console.warn(
      `[pergentic] EDITOR contains shell metacharacters ("${raw}"), falling back to vi`,
    );
    return "vi";
  }

  const base = basename(raw.trim());
  if (!ALLOWED_EDITORS.has(base)) {
    console.warn(
      `[pergentic] EDITOR "${raw}" is not in the allowed editors list, falling back to vi`,
    );
    return "vi";
  }

  return base;
}

export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SpawnOpts {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeout?: number;
  /** Delay before escalating SIGTERM to SIGKILL (defaults to SIGKILL_DELAY_MS). */
  sigkillDelay?: number;
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

export const MAX_OUTPUT = 8192;
export const TRUNCATION_PREFIX = "[Output truncated to last 8KB]\n";

export function capBuffer(
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
    let sigkillTimer: ReturnType<typeof setTimeout> | undefined;
    if (opts.timeout) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        sigkillTimer = setTimeout(() => {
          console.warn(
            `[pergentic] Process ${child.pid} did not exit after SIGTERM, sending SIGKILL`,
          );
          child.kill("SIGKILL");
        }, opts.sigkillDelay ?? SIGKILL_DELAY_MS);
        sigkillTimer.unref();
      }, opts.timeout);
    }

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      reject(err);
    });

    child.on("close", (exitCode) => {
      if (timer) clearTimeout(timer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
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
