import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recordTaskCost, getTaskHistory } from "./cost";
import { statsFilePath } from "../config/paths";

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

	it("records task cost to history", async () => {
		await recordTaskCost("task-1", 1.5, 120, true, false);
		const history = await getTaskHistory();
		expect(history).toHaveLength(1);
		expect(history[0].taskId).toBe("task-1");
		expect(history[0].cost).toBe(1.5);
		expect(history[0].status).toBe("success");
	});

	it("accumulates multiple tasks", async () => {
		await recordTaskCost("task-1", 1.0, 60, true, false);
		await recordTaskCost("task-2", 2.0, 120, false, true);
		const history = await getTaskHistory();
		expect(history).toHaveLength(2);
		expect(history[1].status).toBe("failed");
	});

	it("recovers from corrupted stats file on next write", async () => {
		// Write a corrupted (invalid JSON) stats file
		const statsPath = statsFilePath();
		writeFileSync(statsPath, "{ corrupted json !!!");

		// recordTaskCost should succeed despite the corrupted file
		await expect(recordTaskCost("task-recover", 0.5, 30, false, false)).resolves.not.toThrow();

		// After the write, the file should be valid and contain the new entry
		const history = await getTaskHistory();
		expect(history.some((e) => e.taskId === "task-recover")).toBe(true);
	});
});
