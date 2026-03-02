import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { daemonPidPath } from "../config/paths";

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
