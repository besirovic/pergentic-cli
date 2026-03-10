import { readFileSync, writeFileSync, existsSync, openSync, writeSync, fsyncSync, closeSync, renameSync } from "node:fs";
import { readFile, writeFile, rename, open } from "node:fs/promises";
import type { z } from "zod";
import { logger } from "./logger";

let writeCounter = 0;

export function atomicWriteFile(filePath: string, data: string): void {
  const tmpPath = `${filePath}.${process.pid}.${writeCounter++}.tmp`;
  writeFileSync(tmpPath, data, "utf-8");
  renameSync(tmpPath, filePath);
}

export async function atomicWriteFileAsync(filePath: string, data: string): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.${writeCounter++}.tmp`;
  await writeFile(tmpPath, data, "utf-8");
  await rename(tmpPath, filePath);
}

export function safeJsonParse<T>(filePath: string, fallback: T, schema?: z.ZodType<T>): T {
  if (!existsSync(filePath)) return fallback;
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf-8"));
    if (schema) {
      const result = schema.safeParse(raw);
      return result.success ? result.data : fallback;
    }
    return raw as T;
  } catch (err) {
    logger.warn({ err, filePath }, "Corrupted JSON file, using fallback");
    return fallback;
  }
}

export async function safeJsonParseAsync<T>(filePath: string, fallback: T, schema?: z.ZodType<T>): Promise<T> {
  if (!existsSync(filePath)) return fallback;
  try {
    const raw = JSON.parse(await readFile(filePath, "utf-8"));
    if (schema) {
      const result = schema.safeParse(raw);
      return result.success ? result.data : fallback;
    }
    return raw as T;
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
