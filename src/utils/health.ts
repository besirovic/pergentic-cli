import { readFileSync, writeFileSync, openSync, closeSync, unlinkSync, existsSync } from "node:fs";
import { daemonPidPath, daemonLockPath } from "../config/paths";
import { logger } from "./logger";

export function writePid(pid: number): void {
  writeFileSync(daemonPidPath(), String(pid), "utf-8");
}

export function readPid(): number | null {
  const pidFile = daemonPidPath();
  if (!existsSync(pidFile)) return null;

  const raw = readFileSync(pidFile, "utf-8").trim();
  const pid = parseInt(raw, 10);
  return Number.isNaN(pid) ? null : pid;
}

export function isRunning(): boolean {
  const pid = readPid();
  if (pid === null) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // Process not running, clean stale PID file
    removePid();
    return false;
  }
}

export function removePid(): void {
  const pidFile = daemonPidPath();
  if (existsSync(pidFile)) {
    unlinkSync(pidFile);
  }
}

/**
 * Acquire an exclusive lock file. Returns true if acquired, false if another instance holds it.
 * Uses the 'wx' flag (write + exclusive create) for atomic lock acquisition.
 */
export function acquireLock(): boolean {
  const lockFile = daemonLockPath();
  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const fd = openSync(lockFile, "wx");
      writeFileSync(fd, String(process.pid), "utf-8");
      closeSync(fd);
      return true;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        logger.error({ err }, "Failed to acquire lock file");
        return false;
      }
      // Lock file exists — check if the holding process is still alive
      try {
        const lockPid = parseInt(readFileSync(lockFile, "utf-8").trim(), 10);
        if (!Number.isNaN(lockPid)) {
          process.kill(lockPid, 0); // throws if process doesn't exist
          return false; // process is alive, lock is valid
        }
      } catch {
        // Process is dead or PID unreadable — stale lock
      }
      try {
        unlinkSync(lockFile);
      } catch {
        // Another process may have already removed it; retry will handle it
      }
    }
  }

  logger.warn("Failed to acquire lock after %d attempts", maxAttempts);
  return false;
}

export function releaseLock(): void {
  const lockFile = daemonLockPath();
  if (existsSync(lockFile)) {
    unlinkSync(lockFile);
  }
}
