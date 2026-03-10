import { readFileSync, writeFileSync, existsSync, openSync, writeSync, fsyncSync, closeSync, renameSync } from "node:fs";
import { readFile, writeFile, rename, open } from "node:fs/promises";
import { logger } from "./logger";

export function atomicWriteFile(filePath: string, data: string): void {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, data, "utf-8");
  renameSync(tmpPath, filePath);
}

export async function atomicWriteFileAsync(filePath: string, data: string): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tmpPath, data, "utf-8");
  await rename(tmpPath, filePath);
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

export async function safeJsonParseAsync<T>(filePath: string, fallback: T): Promise<T> {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(await readFile(filePath, "utf-8")) as T;
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

export async function safeAppendFileAsync(filePath: string, data: string): Promise<void> {
  const fh = await open(filePath, "a");
  try {
    await fh.write(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
}
