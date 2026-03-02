import { spawn, type SpawnOptions } from "node:child_process";

export interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface SpawnOpts {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeout?: number;
}

export function spawnAsync(
  command: string,
  args: string[],
  opts: SpawnOpts = {},
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const spawnOpts: SpawnOptions = {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
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
      resolve({ exitCode, stdout, stderr });
    });
  });
}
