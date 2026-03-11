import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  openSync,
  closeSync,
} from "node:fs";
import { dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

function sleepSync(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin */ }
}

/**
 * Acquire an exclusive file lock using O_EXCL (atomic on POSIX).
 * Retries with sleepSync delay up to maxAttempts times.
 * Runs fn() while holding the lock, then releases it.
 */
export function withFileLock<T>(filePath: string, fn: () => T): T {
  const lockPath = filePath + ".lock";
  const maxAttempts = 50;
  const delayMs = 100;

  let acquired = false;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const fd = openSync(lockPath, "wx");
      closeSync(fd);
      acquired = true;
      break;
    } catch {
      sleepSync(delayMs);
    }
  }

  if (!acquired) {
    throw new Error(
      `Failed to acquire lock for ${filePath} after ${maxAttempts * delayMs}ms`,
    );
  }

  try {
    return fn();
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      // lock file may already be gone
    }
  }
}

export function readYaml(filePath: string): unknown {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, "utf-8");
  try {
    return parseYaml(raw) ?? {};
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse YAML config at ${filePath}: ${message}`);
  }
}

export function writeYaml(filePath: string, data: unknown): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmpPath = filePath + ".tmp";
  try {
    writeFileSync(tmpPath, stringifyYaml(data), "utf-8");
    renameSync(tmpPath, filePath);
  } catch (error: unknown) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // tmp file may not exist if writeFileSync failed
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to write YAML config at ${filePath}: ${message}`);
  }
}
