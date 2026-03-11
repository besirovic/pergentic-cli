import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DispatchLedger } from "./ledger";

const TEST_HOME = join("/tmp", `pergentic-ledger-test-${process.pid}`);

function ledgerPath(): string {
  return join(TEST_HOME, "dispatched.jsonl");
}

function makeEntry(id: string, daysAgo: number): string {
  const ts = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  return JSON.stringify({ id, type: "task", timestamp: ts });
}

describe("DispatchLedger.load", () => {
  beforeEach(() => {
    process.env.PERGENTIC_HOME = TEST_HOME;
    if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
    mkdirSync(TEST_HOME, { recursive: true });
  });

  afterEach(() => {
    delete process.env.PERGENTIC_HOME;
    if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
    vi.restoreAllMocks();
  });

  it("loads valid entries into dispatched set", async () => {
    const lines = [makeEntry("task-1", 1), makeEntry("task-2", 2)];
    writeFileSync(ledgerPath(), lines.join("\n") + "\n");

    const ledger = new DispatchLedger();
    await ledger.load();

    expect(ledger.isDispatched("task-1")).toBe(true);
    expect(ledger.isDispatched("task-2")).toBe(true);
  });

  it("creates a backup when corruption threshold is exceeded", async () => {
    const corruptLines = Array.from({ length: 5 }, (_, i) => `not-json-${i}`);
    writeFileSync(ledgerPath(), corruptLines.join("\n") + "\n");

    const ledger = new DispatchLedger();
    await ledger.load();

    const files = readdirSync(TEST_HOME);
    const backups = files.filter((f) => f.includes(".corrupt.") && f.endsWith(".bak"));
    expect(backups).toHaveLength(1);
  });

  it("does not create a backup when few entries are skipped", async () => {
    const lines = [
      makeEntry("task-1", 1),
      "bad-line",
      makeEntry("task-2", 2),
    ];
    writeFileSync(ledgerPath(), lines.join("\n") + "\n");

    const ledger = new DispatchLedger();
    await ledger.load();

    const files = readdirSync(TEST_HOME);
    const backups = files.filter((f) => f.includes(".corrupt.") && f.endsWith(".bak"));
    expect(backups).toHaveLength(0);
    expect(ledger.isDispatched("task-1")).toBe(true);
    expect(ledger.isDispatched("task-2")).toBe(true);
  });

  it("still loads valid entries even when corruption threshold is exceeded", async () => {
    const goodLines = [makeEntry("good-1", 1), makeEntry("good-2", 2)];
    const corruptLines = Array.from({ length: 5 }, (_, i) => `not-json-${i}`);
    writeFileSync(ledgerPath(), [...goodLines, ...corruptLines].join("\n") + "\n");

    const ledger = new DispatchLedger();
    await ledger.load();

    expect(ledger.isDispatched("good-1")).toBe(true);
    expect(ledger.isDispatched("good-2")).toBe(true);
  });
});

describe("DispatchLedger.prune", () => {
  beforeEach(() => {
    process.env.PERGENTIC_HOME = TEST_HOME;
    if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
    mkdirSync(TEST_HOME, { recursive: true });
  });

  afterEach(() => {
    delete process.env.PERGENTIC_HOME;
    if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
  });

  it("retains recent entries and removes old ones", async () => {
    const lines = [
      makeEntry("old-1", 60),
      makeEntry("old-2", 45),
      makeEntry("new-1", 10),
      makeEntry("new-2", 5),
    ];
    writeFileSync(ledgerPath(), lines.join("\n") + "\n");

    const ledger = new DispatchLedger();
    await ledger.load();
    await ledger.prune(30);

    const content = readFileSync(ledgerPath(), "utf-8");
    const remaining = content.trim().split("\n").filter(Boolean);
    expect(remaining).toHaveLength(2);

    const ids = remaining.map((l) => JSON.parse(l).id);
    expect(ids).toContain("new-1");
    expect(ids).toContain("new-2");
    expect(ids).not.toContain("old-1");
    expect(ids).not.toContain("old-2");
  });

  it("updates in-memory dispatched set after pruning", async () => {
    const lines = [makeEntry("old-1", 60), makeEntry("new-1", 5)];
    writeFileSync(ledgerPath(), lines.join("\n") + "\n");

    const ledger = new DispatchLedger();
    await ledger.load();

    expect(ledger.isDispatched("old-1")).toBe(true);
    expect(ledger.isDispatched("new-1")).toBe(true);

    await ledger.prune(30);

    expect(ledger.isDispatched("old-1")).toBe(false);
    expect(ledger.isDispatched("new-1")).toBe(true);
  });

  it("handles empty ledger file without error", async () => {
    writeFileSync(ledgerPath(), "");

    const ledger = new DispatchLedger();
    await ledger.load();
    await expect(ledger.prune(30)).resolves.toBeUndefined();

    const content = readFileSync(ledgerPath(), "utf-8");
    expect(content).toBe("");
  });

  it("produces empty file when all entries are pruned", async () => {
    const lines = [makeEntry("old-1", 60), makeEntry("old-2", 45)];
    writeFileSync(ledgerPath(), lines.join("\n") + "\n");

    const ledger = new DispatchLedger();
    await ledger.load();
    await ledger.prune(30);

    const content = readFileSync(ledgerPath(), "utf-8");
    expect(content).toBe("");
    expect(ledger.isDispatched("old-1")).toBe(false);
    expect(ledger.isDispatched("old-2")).toBe(false);
  });

  it("is a no-op when ledger file does not exist", async () => {
    const ledger = new DispatchLedger();
    await expect(ledger.prune(30)).resolves.toBeUndefined();
    expect(existsSync(ledgerPath())).toBe(false);
  });

  it("skips malformed lines during pruning", async () => {
    const lines = [
      makeEntry("good-1", 5),
      "not valid json",
      makeEntry("good-2", 10),
    ];
    writeFileSync(ledgerPath(), lines.join("\n") + "\n");

    const ledger = new DispatchLedger();
    await ledger.load();
    await ledger.prune(30);

    const content = readFileSync(ledgerPath(), "utf-8");
    const remaining = content.trim().split("\n").filter(Boolean);
    expect(remaining).toHaveLength(2);
    const ids = remaining.map((l) => JSON.parse(l).id);
    expect(ids).toContain("good-1");
    expect(ids).toContain("good-2");
  });

  it("does not leave temp file behind on success", async () => {
    writeFileSync(ledgerPath(), makeEntry("task-1", 5) + "\n");

    const ledger = new DispatchLedger();
    await ledger.load();
    await ledger.prune(30);

    const files = require("node:fs").readdirSync(TEST_HOME) as string[];
    const tmpFiles = files.filter((f: string) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });
});
