import { writeFileSync, openSync, writeSync, fsyncSync, closeSync, renameSync } from "node:fs";

export function atomicWriteFile(filePath: string, data: string): void {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, data, "utf-8");
  renameSync(tmpPath, filePath);
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
