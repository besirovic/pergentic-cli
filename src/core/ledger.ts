import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dispatchedLedgerPath } from "../config/paths";
import { ensureGlobalConfigDir } from "../config/loader";
import { logger } from "../utils/logger";
import { safeAppendFileAsync } from "../utils/fs";

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
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const entry = JSON.parse(trimmed) as LedgerEntry;
          this.dispatched.add(entry.id);
        } catch {
          // Skip malformed lines
        }
      }
      logger.info(
        { count: this.dispatched.size },
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

  async prune(maxAgeDays: number = 30): Promise<void> {
    if (!existsSync(this.filePath)) return;

    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const content = await readFile(this.filePath, "utf-8");
    const retained: string[] = [];
    const retainedIds = new Set<string>();

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed) as LedgerEntry;
        if (new Date(entry.timestamp).getTime() >= cutoff) {
          retained.push(trimmed);
          retainedIds.add(entry.id);
        }
      } catch {
        // Skip malformed lines
      }
    }

    this.dispatched = retainedIds;
    await writeFile(this.filePath, retained.join("\n") + (retained.length ? "\n" : ""));
    logger.info({ retained: retained.length, maxAgeDays }, "Pruned dispatch ledger");
  }
}
