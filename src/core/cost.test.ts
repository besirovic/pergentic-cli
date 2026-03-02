import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { recordTaskCost, getDailyStats, getTaskStats } from "./cost";

const TEST_HOME = join("/tmp", `pergentic-cost-test-${process.pid}`);

describe("cost tracking", () => {
	beforeEach(() => {
		process.env.PERGENTIC_HOME = TEST_HOME;
		if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
		mkdirSync(TEST_HOME, { recursive: true });
	});

	afterEach(() => {
		delete process.env.PERGENTIC_HOME;
		if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
	});

	it("records task cost and updates daily stats", () => {
		recordTaskCost("task-1", 1.5, 120, true, false);
		const stats = getDailyStats();
		expect(stats.tasks).toBe(1);
		expect(stats.prs).toBe(1);
		expect(stats.failed).toBe(0);
		expect(stats.estimatedCost).toBe(1.5);
	});

	it("accumulates multiple tasks", () => {
		recordTaskCost("task-1", 1.0, 60, true, false);
		recordTaskCost("task-2", 2.0, 120, false, true);
		const stats = getDailyStats();
		expect(stats.tasks).toBe(2);
		expect(stats.prs).toBe(1);
		expect(stats.failed).toBe(1);
		expect(stats.estimatedCost).toBe(3.0);
	});

	it("retrieves individual task stats", () => {
		recordTaskCost("task-1", 1.5, 120, true, false);
		const taskStats = getTaskStats("task-1");
		expect(taskStats).toBeDefined();
		expect(taskStats!.cost).toBe(1.5);
		expect(taskStats!.duration).toBe(120);
	});

	it("returns zero stats when no data", () => {
		const stats = getDailyStats();
		expect(stats.tasks).toBe(0);
		expect(stats.estimatedCost).toBe(0);
	});
});
