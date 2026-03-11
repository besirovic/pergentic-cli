import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, openSync, closeSync, unlinkSync, existsSync, renameSync } from "node:fs";
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
 *
 * Fast path: atomic O_CREAT|O_EXCL open ('wx' flag) — only one process can create the file.
 *
 * Stale lock path: when a lock file exists but the holder process is dead, we use an atomic
 * rename to replace it. A unique nonce written to a temp file and renamed over the stale lock
 * lets us verify we won any concurrent replacement race without a separate unlink+create
 * sequence that would reintroduce a TOCTOU window.
 */
export function acquireLock(): boolean {
  const lockFile = daemonLockPath();
  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Fast path: atomic exclusive create (O_CREAT|O_EXCL).
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
    }

    // Lock file exists — check if the holder process is still alive.
    let holderPid: number = NaN;
    try {
      // parseInt stops at ':' so it correctly extracts the PID from both
      // "pid" (fast-path) and "pid:nonce" (rename-path) content formats.
      holderPid = parseInt(readFileSync(lockFile, "utf-8").trim(), 10);
    } catch {
      // File removed between our open-check and read — retry fast path.
      continue;
    }

    if (!Number.isNaN(holderPid)) {
      try {
        process.kill(holderPid, 0);
        return false; // process is alive, lock is valid
      } catch (killErr: unknown) {
        const code =
          killErr instanceof Error && "code" in killErr
            ? (killErr as NodeJS.ErrnoException).code
            : undefined;
        if (code === "EPERM") {
          return false; // alive but owned by a different user
        }
        // ESRCH — process is dead, stale lock
      }
    }

    // Stale lock detected. Replace it atomically using rename so that two
    // concurrent processes racing on the same stale lock can both proceed
    // without either incorrectly believing it holds the lock.
    //
    // Both processes write their claim to distinct temp files then rename
    // over the stale lock. rename(2) is atomic on POSIX — the last rename
    // wins. After renaming, each process reads the lock back and checks
    // whether its unique nonce is still present. Only one can win; the
    // other detects the mismatch and returns false.
    const nonce = randomBytes(8).toString("hex");
    const claim = `${process.pid}:${nonce}`;
    const tempFile = `${lockFile}.${process.pid}.${nonce}.tmp`;

    try {
      writeFileSync(tempFile, claim, { encoding: "utf-8", mode: FILE_MODES.SECURE });
      renameSync(tempFile, lockFile);

      // Verify our rename won the race.
      try {
        const content = readFileSync(lockFile, "utf-8").trim();
        if (content === claim) {
          return true; // we hold the lock
        }
        // Another process's rename landed after ours — they hold the lock.
        return false;
      } catch {
        // Lock file disappeared again; retry fast path.
        continue;
      }
    } catch {
      // Temp file creation or rename failed; clean up and retry.
      try {
        unlinkSync(tempFile);
      } catch {
        // Already gone or never created — ignore.
      }
    }
  }

  logger.warn("Failed to acquire lock after %d attempts", maxAttempts);
  return false;
}

export function releaseLock(): void {
  const lockFile = daemonLockPath();
  try {
    const content = readFileSync(lockFile, "utf-8").trim();
    // parseInt handles both "pid" and "pid:nonce" content formats.
    const storedPid = parseInt(content, 10);
    if (storedPid === process.pid) {
      unlinkSync(lockFile);
    }
  } catch {
    // File doesn't exist or is unreadable — nothing to release.
  }
}
