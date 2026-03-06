import { describe, it, expect } from "vitest";
import { formatDuration } from "./format";

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
