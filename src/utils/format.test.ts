import { describe, it, expect } from "vitest";
import { escapeXml, formatDuration } from "./format";

describe("escapeXml", () => {
	it("escapes all five XML-special characters", () => {
		expect(escapeXml('a&b<c>d"e\'f')).toBe(
			"a&amp;b&lt;c&gt;d&quot;e&apos;f"
		);
	});

	it("escapes ampersand in path", () => {
		expect(escapeXml("/usr/local/bin/node&foo")).toBe(
			"/usr/local/bin/node&amp;foo"
		);
	});

	it("escapes angle brackets in path", () => {
		expect(escapeXml("/path/<dir>/file")).toBe("/path/&lt;dir&gt;/file");
	});

	it("returns empty string unchanged", () => {
		expect(escapeXml("")).toBe("");
	});

	it("returns normal path unchanged", () => {
		expect(escapeXml("/usr/local/bin/node")).toBe("/usr/local/bin/node");
	});

	it("handles multiple ampersands", () => {
		expect(escapeXml("a&b&c")).toBe("a&amp;b&amp;c");
	});
});

describe("formatDuration", () => {
	it("formats seconds only", () => {
		expect(formatDuration(45)).toBe("45s");
	});

	it("formats minutes and seconds", () => {
		expect(formatDuration(125)).toBe("2m 5s");
	});

	it("formats hours and minutes", () => {
		expect(formatDuration(3725)).toBe("1h 2m");
	});

	it("formats zero", () => {
		expect(formatDuration(0)).toBe("0s");
	});

	it("formats exactly one minute", () => {
		expect(formatDuration(60)).toBe("1m 0s");
	});

	it("formats exactly one hour", () => {
		expect(formatDuration(3600)).toBe("1h 0m");
	});
});
