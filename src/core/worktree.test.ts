import { describe, it, expect } from "vitest";
import { slugify } from "./worktree";

describe("slugify", () => {
	it("converts to lowercase and replaces non-alphanumeric", () => {
		expect(slugify("Hello World")).toBe("hello-world");
	});

	it("strips leading and trailing dashes", () => {
		expect(slugify("--hello--")).toBe("hello");
	});

	it("handles special characters", () => {
		expect(slugify("Fix: bug #123 (critical)")).toBe("fix-bug-123-critical");
	});

	it("returns short slugs as-is", () => {
		const short = "short-slug";
		expect(slugify(short)).toBe("short-slug");
	});

	it("keeps strings at 50 chars without hash", () => {
		const text = "a".repeat(50);
		const result = slugify(text);
		expect(result).toBe(text);
		expect(result.length).toBe(50);
	});

	it("adds hash suffix for long strings", () => {
		const text = "this-is-a-very-long-title-that-exceeds-the-maximum-length-allowed-for-branch-names";
		const result = slugify(text);
		expect(result.length).toBe(50);
		expect(result).toMatch(/^.{42}-[a-f0-9]{7}$/);
	});

	it("returns hash-based fallback for all-special-character input", () => {
		const result = slugify("!!!");
		expect(result).toMatch(/^task-[a-f0-9]{7}$/);
	});

	it("returns hash-based fallback for empty string", () => {
		const result = slugify("");
		expect(result).toMatch(/^task-[a-f0-9]{7}$/);
	});

	it("produces different slugs for similar long strings", () => {
		const a = "a".repeat(60) + "-variant-one";
		const b = "a".repeat(60) + "-variant-two";
		const slugA = slugify(a);
		const slugB = slugify(b);
		expect(slugA).not.toBe(slugB);
	});
});
