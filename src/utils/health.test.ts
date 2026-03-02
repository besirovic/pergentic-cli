import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { writePid, readPid, isRunning, removePid } from "./health";

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
