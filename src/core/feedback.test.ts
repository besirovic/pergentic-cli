import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
	initHistory,
	loadHistory,
	addFeedbackRound,
	buildFeedbackPrompt,
} from "./feedback";

const TEST_DIR = join("/tmp", `pergentic-feedback-test-${process.pid}`);

describe("feedback", () => {
	beforeEach(() => {
		if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
		mkdirSync(TEST_DIR, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
	});

	it("initializes history", () => {
		const history = initHistory(TEST_DIR, "TASK-1", "Build the feature");
		expect(history.taskId).toBe("TASK-1");
		expect(history.originalDescription).toBe("Build the feature");
		expect(history.feedbackRounds).toEqual([]);
	});

	it("loads saved history", () => {
		initHistory(TEST_DIR, "TASK-1", "Build the feature");
		const loaded = loadHistory(TEST_DIR);
		expect(loaded).not.toBeNull();
		expect(loaded!.taskId).toBe("TASK-1");
	});

	it("returns null for missing history", () => {
		expect(loadHistory(TEST_DIR)).toBeNull();
	});

	it("adds feedback rounds", () => {
		initHistory(TEST_DIR, "TASK-1", "Build the feature");
		const updated = addFeedbackRound(TEST_DIR, "Fix the mobile layout");
		expect(updated.feedbackRounds).toHaveLength(1);
		expect(updated.feedbackRounds[0].round).toBe(1);
		expect(updated.feedbackRounds[0].comment).toBe("Fix the mobile layout");

		const updated2 = addFeedbackRound(TEST_DIR, "Add a spinner");
		expect(updated2.feedbackRounds).toHaveLength(2);
		expect(updated2.feedbackRounds[1].round).toBe(2);
	});

	it("builds feedback prompt with full history", () => {
		const history = initHistory(TEST_DIR, "TASK-1", "Add billing");
		addFeedbackRound(TEST_DIR, "Fix mobile");

		const updated = loadHistory(TEST_DIR)!;
		const prompt = buildFeedbackPrompt(
			updated,
			"Add spinner",
			"src/Billing.tsx",
			42
		);

		expect(prompt).toContain("TASK-1");
		expect(prompt).toContain("Add billing");
		expect(prompt).toContain('Round 1: "Fix mobile"');
		expect(prompt).toContain("Round 2");
		expect(prompt).toContain("Add spinner");
		expect(prompt).toContain("src/Billing.tsx");
		expect(prompt).toContain("line 42");
		expect(prompt).toContain("without regressing");
	});
});
