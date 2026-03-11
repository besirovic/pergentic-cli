import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
	detectPRTemplate,
	readAgentPRBody,
	buildPRTemplatePromptSection,
	PR_BODY_OUTPUT_FILE,
	truncateUtf8,
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

	it("returns null when no template exists", async () => {
		expect(await detectPRTemplate(TEST_DIR)).toBeNull();
	});

	it("detects .github/PULL_REQUEST_TEMPLATE.md", async () => {
		const dir = join(TEST_DIR, ".github");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "PULL_REQUEST_TEMPLATE.md"), "## What\n\n## Why");

		expect(await detectPRTemplate(TEST_DIR)).toBe("## What\n\n## Why");
	});

	it("detects lowercase variant", async () => {
		const dir = join(TEST_DIR, ".github");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "pull_request_template.md"), "lowercase");

		expect(await detectPRTemplate(TEST_DIR)).toBe("lowercase");
	});

	it("detects root-level template", async () => {
		writeFileSync(join(TEST_DIR, "PULL_REQUEST_TEMPLATE.md"), "root template");
		expect(await detectPRTemplate(TEST_DIR)).toBe("root template");
	});

	it("detects template directory (picks first alphabetically)", async () => {
		const dir = join(TEST_DIR, ".github", "PULL_REQUEST_TEMPLATE");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "bug.md"), "bug template");
		writeFileSync(join(dir, "feature.md"), "feature template");

		expect(await detectPRTemplate(TEST_DIR)).toBe("bug template");
	});

	it("uses explicit path when provided", async () => {
		mkdirSync(join(TEST_DIR, "custom"), { recursive: true });
		writeFileSync(join(TEST_DIR, "custom", "pr.md"), "custom template");

		expect(await detectPRTemplate(TEST_DIR, "custom/pr.md")).toBe("custom template");
	});

	it("falls back to auto-detect when explicit path not found", async () => {
		const dir = join(TEST_DIR, ".github");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "PULL_REQUEST_TEMPLATE.md"), "fallback");

		expect(await detectPRTemplate(TEST_DIR, "nonexistent.md")).toBe("fallback");
	});

	it("rejects path traversal in explicit path", async () => {
		expect(await detectPRTemplate(TEST_DIR, "../../etc/passwd")).toBeNull();
	});

	it("truncates templates exceeding size limit", async () => {
		const dir = join(TEST_DIR, ".github");
		mkdirSync(dir, { recursive: true });
		const large = "x".repeat(20_000);
		writeFileSync(join(dir, "PULL_REQUEST_TEMPLATE.md"), large);

		const result = await detectPRTemplate(TEST_DIR);
		expect(result).not.toBeNull();
		// ASCII-only: truncation is exactly at byte boundary
		expect(Buffer.byteLength(result!, "utf-8")).toBe(10 * 1024);
	});

	it("truncates emoji content without producing invalid UTF-8", async () => {
		const dir = join(TEST_DIR, ".github");
		mkdirSync(dir, { recursive: true });
		// Each emoji (🎉) is 4 bytes in UTF-8; fill well beyond 10 KB
		const large = "🎉".repeat(5_000);
		writeFileSync(join(dir, "PULL_REQUEST_TEMPLATE.md"), large);

		const result = await detectPRTemplate(TEST_DIR);
		expect(result).not.toBeNull();
		expect(Buffer.byteLength(result!, "utf-8")).toBeLessThanOrEqual(10 * 1024);
		// Verify no replacement characters (would indicate broken UTF-8)
		expect(result).not.toContain("\uFFFD");
		// Every character should be a complete emoji
		for (const ch of result!) {
			expect(ch).toBe("🎉");
		}
	});

	it("truncates multi-byte content by bytes, not characters", async () => {
		const dir = join(TEST_DIR, ".github");
		mkdirSync(dir, { recursive: true });
		// Each "é" is 2 bytes in UTF-8; fill well beyond the 10 KB limit
		const large = "é".repeat(10_000);
		writeFileSync(join(dir, "PULL_REQUEST_TEMPLATE.md"), large);

		const result = await detectPRTemplate(TEST_DIR);
		expect(result).not.toBeNull();
		expect(Buffer.byteLength(result!, "utf-8")).toBeLessThanOrEqual(10 * 1024);
		// Character count must be less than byte limit since each char is 2 bytes
		expect(result!.length).toBeLessThan(10 * 1024);
	});
});

describe("readAgentPRBody", () => {
	beforeEach(setup);
	afterEach(teardown);

	it("returns null when file does not exist", async () => {
		expect(await readAgentPRBody(TEST_DIR)).toBeNull();
	});

	it("returns null for empty file", async () => {
		const dir = join(TEST_DIR, ".pergentic");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(TEST_DIR, PR_BODY_OUTPUT_FILE), "   \n  ");

		expect(await readAgentPRBody(TEST_DIR)).toBeNull();
	});

	it("reads and trims agent-generated PR body", async () => {
		const dir = join(TEST_DIR, ".pergentic");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(TEST_DIR, PR_BODY_OUTPUT_FILE), "\n## Summary\nDid stuff\n\n");

		expect(await readAgentPRBody(TEST_DIR)).toBe("## Summary\nDid stuff");
	});
});

describe("truncateUtf8", () => {
	it("returns the buffer unchanged when within limit", () => {
		const buf = Buffer.from("hello", "utf-8");
		const result = truncateUtf8(buf, 100);
		expect(result.toString("utf-8")).toBe("hello");
	});

	it("truncates ASCII at exact byte boundary", () => {
		const buf = Buffer.from("abcdefgh", "utf-8");
		const result = truncateUtf8(buf, 5);
		expect(result.toString("utf-8")).toBe("abcde");
	});

	it("does not split 2-byte characters", () => {
		// "é" is 2 bytes (0xC3 0xA9)
		const buf = Buffer.from("aé", "utf-8"); // 3 bytes total
		const result = truncateUtf8(buf, 2);
		// Can't fit "é" (needs byte 1-2), so only "a"
		expect(result.toString("utf-8")).toBe("a");
	});

	it("does not split 3-byte characters", () => {
		// "€" is 3 bytes (0xE2 0x82 0xAC)
		const buf = Buffer.from("a€b", "utf-8"); // 1 + 3 + 1 = 5 bytes
		const result = truncateUtf8(buf, 3);
		// Can't fit full "€" (starts at byte 1, needs 3 bytes, would end at byte 4)
		expect(result.toString("utf-8")).toBe("a");
	});

	it("does not split 4-byte emoji characters", () => {
		// "🎉" is 4 bytes
		const buf = Buffer.from("a🎉b", "utf-8"); // 1 + 4 + 1 = 6 bytes
		const result = truncateUtf8(buf, 4);
		// Can't fit "🎉" (starts at byte 1, needs 4 bytes, would end at byte 5)
		expect(result.toString("utf-8")).toBe("a");
	});

	it("includes multi-byte character when it fits exactly", () => {
		const buf = Buffer.from("a🎉b", "utf-8"); // 1 + 4 + 1 = 6 bytes
		const result = truncateUtf8(buf, 5);
		expect(result.toString("utf-8")).toBe("a🎉");
	});

	it("produces valid UTF-8 for all boundary cases", () => {
		const input = "Hello 🌍 world é € 🎉 test";
		const buf = Buffer.from(input, "utf-8");
		for (let i = 1; i <= buf.length; i++) {
			const result = truncateUtf8(buf, i);
			const str = result.toString("utf-8");
			// No replacement characters means valid UTF-8
			expect(str).not.toContain("\uFFFD");
			expect(Buffer.byteLength(str, "utf-8")).toBeLessThanOrEqual(i);
		}
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
