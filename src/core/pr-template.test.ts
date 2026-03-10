import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
	detectPRTemplate,
	readAgentPRBody,
	buildPRTemplatePromptSection,
	PR_BODY_OUTPUT_FILE,
} from "./pr-template";

const TEST_DIR = join("/tmp", `pergentic-pr-template-test-${process.pid}`);

function setup() {
	if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
	mkdirSync(TEST_DIR, { recursive: true });
}

function teardown() {
	if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
}

describe("detectPRTemplate", () => {
	beforeEach(setup);
	afterEach(teardown);

	it("returns null when no template exists", () => {
		expect(detectPRTemplate(TEST_DIR)).toBeNull();
	});

	it("detects .github/PULL_REQUEST_TEMPLATE.md", () => {
		const dir = join(TEST_DIR, ".github");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "PULL_REQUEST_TEMPLATE.md"), "## What\n\n## Why");

		expect(detectPRTemplate(TEST_DIR)).toBe("## What\n\n## Why");
	});

	it("detects lowercase variant", () => {
		const dir = join(TEST_DIR, ".github");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "pull_request_template.md"), "lowercase");

		expect(detectPRTemplate(TEST_DIR)).toBe("lowercase");
	});

	it("detects root-level template", () => {
		writeFileSync(join(TEST_DIR, "PULL_REQUEST_TEMPLATE.md"), "root template");
		expect(detectPRTemplate(TEST_DIR)).toBe("root template");
	});

	it("detects template directory (picks first alphabetically)", () => {
		const dir = join(TEST_DIR, ".github", "PULL_REQUEST_TEMPLATE");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "bug.md"), "bug template");
		writeFileSync(join(dir, "feature.md"), "feature template");

		expect(detectPRTemplate(TEST_DIR)).toBe("bug template");
	});

	it("uses explicit path when provided", () => {
		mkdirSync(join(TEST_DIR, "custom"), { recursive: true });
		writeFileSync(join(TEST_DIR, "custom", "pr.md"), "custom template");

		expect(detectPRTemplate(TEST_DIR, "custom/pr.md")).toBe("custom template");
	});

	it("falls back to auto-detect when explicit path not found", () => {
		const dir = join(TEST_DIR, ".github");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "PULL_REQUEST_TEMPLATE.md"), "fallback");

		expect(detectPRTemplate(TEST_DIR, "nonexistent.md")).toBe("fallback");
	});

	it("rejects path traversal in explicit path", () => {
		expect(detectPRTemplate(TEST_DIR, "../../etc/passwd")).toBeNull();
	});

	it("truncates templates exceeding size limit", () => {
		const dir = join(TEST_DIR, ".github");
		mkdirSync(dir, { recursive: true });
		const large = "x".repeat(20_000);
		writeFileSync(join(dir, "PULL_REQUEST_TEMPLATE.md"), large);

		const result = detectPRTemplate(TEST_DIR);
		expect(result).not.toBeNull();
		expect(result!.length).toBe(10 * 1024);
	});
});

describe("readAgentPRBody", () => {
	beforeEach(setup);
	afterEach(teardown);

	it("returns null when file does not exist", () => {
		expect(readAgentPRBody(TEST_DIR)).toBeNull();
	});

	it("returns null for empty file", () => {
		const dir = join(TEST_DIR, ".pergentic");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(TEST_DIR, PR_BODY_OUTPUT_FILE), "   \n  ");

		expect(readAgentPRBody(TEST_DIR)).toBeNull();
	});

	it("reads and trims agent-generated PR body", () => {
		const dir = join(TEST_DIR, ".pergentic");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(TEST_DIR, PR_BODY_OUTPUT_FILE), "\n## Summary\nDid stuff\n\n");

		expect(readAgentPRBody(TEST_DIR)).toBe("## Summary\nDid stuff");
	});
});

describe("buildPRTemplatePromptSection", () => {
	it("wraps template in instructions with code fence", () => {
		const section = buildPRTemplatePromptSection("## What\n## Why");

		expect(section).toContain("## PR Description");
		expect(section).toContain(PR_BODY_OUTPUT_FILE);
		expect(section).toContain("```markdown");
		expect(section).toContain("## What\n## Why");
		expect(section).toContain("```");
	});
});
