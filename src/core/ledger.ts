import { existsSync, createReadStream, createWriteStream } from "node:fs";
import { readFile, rename, unlink, copyFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dispatchedLedgerPath } from "../config/paths";
import { ensureGlobalConfigDir } from "../config/loader";
import { logger } from "../utils/logger";
import { safeAppendFileAsync } from "../utils/fs";

const DEFAULT_LEDGER_RETENTION_DAYS = 30;

interface LedgerEntry {
  id: string;
  type: "task" | "comment";
  timestamp: string;
}

export class DispatchLedger {
  private dispatched = new Set<string>();
  private filePath: string;

  constructor() {
    this.filePath = dispatchedLedgerPath();
  }

  async load(): Promise<void> {
    ensureGlobalConfigDir();

    if (!existsSync(this.filePath)) return;

    try {
      const content = await readFile(this.filePath, "utf-8");
      const lines = content.split("\n");
      let skippedCount = 0;
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed) continue;
        try {
          const entry = JSON.parse(trimmed) as LedgerEntry;
          this.dispatched.add(entry.id);
        } catch (err) {
          skippedCount++;
          logger.warn({ err, line: trimmed, lineNumber: i + 1 }, "Skipping malformed ledger entry");
        }
      }
      logger.info(
        { count: this.dispatched.size, skipped: skippedCount },
        "Loaded dispatch ledger",
      );
    } catch (err) {
      logger.warn({ err }, "Failed to load dispatch ledger, starting fresh");
    }
  }

  async markDispatched(id: string, type: "task" | "comment" = "task"): Promise<void> {
    if (this.dispatched.has(id)) return;
    this.dispatched.add(id);

    const entry: LedgerEntry = {
      id,
      type,
      timestamp: new Date().toISOString(),
    };

    try {
      await safeAppendFileAsync(this.filePath, JSON.stringify(entry) + "\n");
    } catch (err) {
      logger.error({ err, id }, "Failed to persist dispatch ledger entry");
    }
  }

  isDispatched(id: string): boolean {
    return this.dispatched.has(id);
  }

  async prune(maxAgeDays: number = DEFAULT_LEDGER_RETENTION_DAYS): Promise<void> {
    if (!existsSync(this.filePath)) return;

    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    const bakPath = `${this.filePath}.bak`;
    const retainedIds = new Set<string>();
    let retainedCount = 0;
    let skippedCount = 0;

    try {
      await copyFile(this.filePath, bakPath);

      const readStream = createReadStream(this.filePath, { encoding: "utf-8" });
      const writeStream = createWriteStream(tmpPath, { encoding: "utf-8" });

      // Track errors during writes to prevent unhandled error events
      let writeError: Error | null = null;
      writeStream.on("error", (err) => { writeError = err; });

      const rl = createInterface({ input: readStream, crlfDelay: Infinity });

      let lineNumber = 0;
      for await (const line of rl) {
        lineNumber++;
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const entry = JSON.parse(trimmed) as LedgerEntry;
          if (new Date(entry.timestamp).getTime() >= cutoff) {
            if (!writeStream.destroyed) {
              writeStream.write(trimmed + "\n");
            }
            retainedIds.add(entry.id);
            retainedCount++;
          }
        } catch (err) {
          skippedCount++;
          logger.warn({ err, line: trimmed, lineNumber }, "Skipping malformed ledger entry during prune");
        }
      }

      // If stream already errored during writes, reject immediately
      if (writeError) {
        throw writeError;
      }

      await new Promise<void>((resolve, reject) => {
        writeStream.once("error", reject);
        writeStream.end(() => resolve());
      });

      await rename(tmpPath, this.filePath);
      this.dispatched = retainedIds;
      logger.info({ retained: retainedCount, skipped: skippedCount, maxAgeDays }, "Pruned dispatch ledger");
    } catch (err) {
      // Clean up temp file if anything fails, preserving the original
      try { await unlink(tmpPath); } catch { /* temp file may not exist */ }
      throw err;
    }
  }
}
