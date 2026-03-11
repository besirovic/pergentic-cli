import { randomBytes } from "node:crypto";
import { readFileSync, existsSync, openSync, writeSync, fsyncSync, closeSync, renameSync } from "node:fs";
import { readFile, rename, open } from "node:fs/promises";
import type { z } from "zod";
import { FILE_MODES } from "../config/constants";
import { logger } from "./logger";

function uniqueTmpPath(filePath: string): string {
  return `${filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
}

export function atomicWriteFile(filePath: string, data: string, mode = FILE_MODES.SECURE): void {
  const tmpPath = uniqueTmpPath(filePath);
  const fd = openSync(tmpPath, "w", mode);
  try {
    writeSync(fd, data, 0, "utf-8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, filePath);
}

export async function atomicWriteFileAsync(filePath: string, data: string, mode = FILE_MODES.SECURE): Promise<void> {
  const tmpPath = uniqueTmpPath(filePath);
  const fh = await open(tmpPath, "w", mode);
  try {
    await fh.write(data, 0, "utf-8");
    await fh.sync();
  } finally {
    await fh.close();
  }
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
  try {
    const raw = JSON.parse(await readFile(filePath, "utf-8"));
    if (schema) {
      const result = schema.safeParse(raw);
      return result.success ? result.data : fallback;
    }
    return raw as T;
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
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
