import { readFileSync, writeFileSync, openSync, closeSync, unlinkSync, existsSync } from "node:fs";
import { daemonPidPath, daemonLockPath } from "../config/paths";
import { FILE_MODES } from "../config/constants";
import { logger } from "./logger";

export function writePid(pid: number): void {
  writeFileSync(daemonPidPath(), String(pid), { encoding: "utf-8", mode: FILE_MODES.SECURE });
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
  } catch (err: unknown) {
    const code =
      err instanceof Error && "code" in err
        ? (err as NodeJS.ErrnoException).code
        : undefined;
    if (code === "EPERM") {
      // Permission denied — process exists but we can't signal it (different user)
      return true;
    }
    // ESRCH or unknown error — process not running, clean stale PID file
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
      const fd = openSync(lockFile, "wx", FILE_MODES.SECURE);
      try {
        writeFileSync(fd, String(process.pid), "utf-8");
      } finally {
        closeSync(fd);
      }
      return true;
    } catch (err: unknown) {
      const code =
        err instanceof Error && "code" in err
          ? (err as NodeJS.ErrnoException).code
          : undefined;
      if (code !== "EEXIST") {
        logger.error({ err }, "Failed to acquire lock file");
        return false;
      }
      // Lock file exists — check if the holding process is still alive
      let originalPid = NaN;
      try {
        originalPid = parseInt(readFileSync(lockFile, "utf-8").trim(), 10);
        if (!Number.isNaN(originalPid)) {
          process.kill(originalPid, 0); // throws if process doesn't exist
          return false; // process is alive, lock is valid
        }
      } catch {
        // Process is dead or PID unreadable — stale lock
      }
      // Guard against TOCTOU race: between the liveness check above and
      // the unlink below, the stale lock could be cleaned up by another
      // instance which then creates a new valid lock with a different PID.
      // Re-read to verify the PID hasn't changed before removing.
      try {
        const currentPid = parseInt(readFileSync(lockFile, "utf-8").trim(), 10);
        if (!Number.isNaN(currentPid) && currentPid !== originalPid) {
          // PID changed — another process acquired a new lock; don't steal it
          return false;
        }
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
