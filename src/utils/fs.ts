import { readFileSync, writeFileSync, existsSync, openSync, writeSync, fsyncSync, closeSync, renameSync } from "node:fs";
import { logger } from "./logger";

export function atomicWriteFile(filePath: string, data: string): void {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, data, "utf-8");
  renameSync(tmpPath, filePath);
}

export function safeJsonParse<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch (err) {
    logger.warn({ err, filePath }, "Corrupted JSON file, using fallback");
    return fallback;
  }
}

export function safeAppendFile(filePath: string, data: string): void {
  const fd = openSync(filePath, "a");
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
