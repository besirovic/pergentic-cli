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

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
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
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
  });
}
