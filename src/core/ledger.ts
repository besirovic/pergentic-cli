import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { dispatchedLedgerPath } from "../config/paths";
import { ensureGlobalConfigDir } from "../config/loader";
import { logger } from "../utils/logger";

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

  load(): void {
    ensureGlobalConfigDir();

    if (!existsSync(this.filePath)) return;

    try {
      const content = readFileSync(this.filePath, "utf-8");
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

  markDispatched(id: string, type: "task" | "comment" = "task"): void {
    if (this.dispatched.has(id)) return;
    this.dispatched.add(id);

    const entry: LedgerEntry = {
      id,
      type,
      timestamp: new Date().toISOString(),
    };

    try {
      appendFileSync(this.filePath, JSON.stringify(entry) + "\n");
    } catch (err) {
      logger.error({ err, id }, "Failed to persist dispatch ledger entry");
    }
  }

  isDispatched(id: string): boolean {
    return this.dispatched.has(id);
  }
}
