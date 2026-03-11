import { existsSync, createReadStream, createWriteStream } from "node:fs";
import { readFile, rename, unlink, copyFile, open } from "node:fs/promises";
import { dirname } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
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

    // Create backup before any write attempt; preserved on error per acceptance criteria
    await copyFile(this.filePath, bakPath);

    const readStream = createReadStream(this.filePath, { encoding: "utf-8" });
    const writeStream = createWriteStream(tmpPath, { encoding: "utf-8" });

    // Line-splitting filter transform: buffers partial lines, parses JSON, retains by age
    let remainder = "";
    const lineFilter = new Transform({
      encoding: "utf-8",
      transform(chunk: string, _encoding, callback) {
        const lines = (remainder + chunk).split("\n");
        remainder = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const entry = JSON.parse(trimmed) as LedgerEntry;
            if (new Date(entry.timestamp).getTime() >= cutoff) {
              retainedIds.add(entry.id);
              retainedCount++;
              this.push(trimmed + "\n");
            }
          } catch (err) {
            skippedCount++;
            logger.warn({ err, line: trimmed }, "Skipping malformed ledger entry during prune");
          }
        }
        callback();
      },
      flush(callback) {
        if (remainder.trim()) {
          try {
            const entry = JSON.parse(remainder.trim()) as LedgerEntry;
            if (new Date(entry.timestamp).getTime() >= cutoff) {
              retainedIds.add(entry.id);
              retainedCount++;
              this.push(remainder.trim() + "\n");
            }
          } catch (err) {
            skippedCount++;
            logger.warn({ err, line: remainder.trim() }, "Skipping malformed ledger entry during prune");
          }
        }
        callback();
      },
    });

    try {
      // pipeline() destroys all streams on error — no orphaned handles
      await pipeline(readStream, lineFilter, writeStream);

      // fsync the tmp file to guarantee all written bytes reach disk before rename
      const tmpFh = await open(tmpPath, "r");
      try {
        await tmpFh.sync();
      } finally {
        await tmpFh.close();
      }

      await rename(tmpPath, this.filePath);

      // fsync the directory to guarantee the rename metadata persists to disk
      const dirFh = await open(dirname(this.filePath), "r");
      try {
        await dirFh.sync();
      } finally {
        await dirFh.close();
      }

      // Only update in-memory state after both fsyncs succeed
      this.dispatched = retainedIds;
      logger.info({ retained: retainedCount, skipped: skippedCount, maxAgeDays }, "Pruned dispatch ledger");
    } catch (err) {
      // Clean up temp file on all error paths; .bak is preserved intentionally
      try { await unlink(tmpPath); } catch { /* temp file may not exist */ }
      throw err;
    }
  }
}
