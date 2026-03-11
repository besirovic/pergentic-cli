import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writePid, readPid, isRunning, removePid, acquireLock, releaseLock } from "./health";

const TEST_HOME = join("/tmp", `pergentic-health-test-${process.pid}`);

describe("health utilities", () => {
	beforeEach(() => {
		process.env.PERGENTIC_HOME = TEST_HOME;
		if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
		mkdirSync(TEST_HOME, { recursive: true });
	});

	afterEach(() => {
		delete process.env.PERGENTIC_HOME;
		if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
	});

	it("writes and reads PID", () => {
		writePid(12345);
		expect(readPid()).toBe(12345);
	});

	it("returns null when no PID file", () => {
		expect(readPid()).toBeNull();
	});

	it("detects current process as running", () => {
		writePid(process.pid);
		expect(isRunning()).toBe(true);
	});

	it("detects non-existent process and cleans PID", () => {
		writePid(999999); // unlikely to exist
		expect(isRunning()).toBe(false);
		expect(readPid()).toBeNull(); // stale PID cleaned
	});

	it("removes PID file", () => {
		writePid(12345);
		removePid();
		expect(readPid()).toBeNull();
	});

	it("removePid is safe when no file exists", () => {
		expect(() => removePid()).not.toThrow();
	});
});

describe("acquireLock / releaseLock", () => {
	beforeEach(() => {
		process.env.PERGENTIC_HOME = TEST_HOME;
		if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
		mkdirSync(TEST_HOME, { recursive: true });
	});

	afterEach(() => {
		releaseLock();
		delete process.env.PERGENTIC_HOME;
		if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
	});

	it("acquires the lock when no lock file exists", () => {
		expect(acquireLock()).toBe(true);
	});

	it("returns false when a live process holds the lock", () => {
		// Write our own PID as the holder — we are alive
		const lockPath = join(TEST_HOME, "daemon.lock");
		writeFileSync(lockPath, String(process.pid), { mode: 0o600 });
		expect(acquireLock()).toBe(false);
	});

	it("steals a stale lock from a dead process", () => {
		const lockPath = join(TEST_HOME, "daemon.lock");
		// Use a PID that is extremely unlikely to exist
		writeFileSync(lockPath, "999999", { mode: 0o600 });
		expect(acquireLock()).toBe(true);
	});

	it("releaseLock removes the lock file when we own it", () => {
		const lockPath = join(TEST_HOME, "daemon.lock");
		expect(acquireLock()).toBe(true);
		expect(existsSync(lockPath)).toBe(true);
		releaseLock();
		expect(existsSync(lockPath)).toBe(false);
	});

	it("releaseLock does not remove a lock owned by another PID", () => {
		const lockPath = join(TEST_HOME, "daemon.lock");
		writeFileSync(lockPath, "999999", { mode: 0o600 });
		releaseLock(); // should not remove — PID 999999 ≠ process.pid
		expect(existsSync(lockPath)).toBe(true);
	});

	it("releaseLock is safe when no lock file exists", () => {
		expect(() => releaseLock()).not.toThrow();
	});

	it("only one of many concurrent acquisitions succeeds on a stale lock", async () => {
		const lockPath = join(TEST_HOME, "daemon.lock");
		// Plant a stale lock (dead PID)
		writeFileSync(lockPath, "999999", { mode: 0o600 });

		// Simulate concurrent acquisition attempts in the same process by
		// running acquireLock() in many micro-tasks without yielding between
		// them.  Because we're single-threaded, calls are serialised, but the
		// stale-lock rename logic ensures correctness under any ordering.
		const concurrency = 50;
		const results = await Promise.all(
			Array.from({ length: concurrency }, () =>
				Promise.resolve().then(() => acquireLock()),
			),
		);

		const successes = results.filter(Boolean).length;
		expect(successes).toBe(1);
	});
});
