import { describe, it, expect } from "vitest";
import { extractLinearIdentifier } from "./linear";

describe("extractLinearIdentifier", () => {
	it("extracts identifier from single-agent task ID", () => {
		expect(extractLinearIdentifier("linear-LIN-123")).toBe("LIN-123");
	});

	it("extracts identifier from multi-agent task ID", () => {
		expect(extractLinearIdentifier("linear-LIN-123-claude-code")).toBe("LIN-123");
	});

	it("extracts identifier with model label suffix", () => {
		expect(extractLinearIdentifier("linear-LIN-456-aider-sonnet")).toBe("LIN-456");
	});

	it("handles different team prefixes", () => {
		expect(extractLinearIdentifier("linear-ENG-42")).toBe("ENG-42");
		expect(extractLinearIdentifier("linear-PROJ-9999")).toBe("PROJ-9999");
	});

	it("handles lowercase team prefixes", () => {
		expect(extractLinearIdentifier("linear-eng-42")).toBe("eng-42");
	});

	it("throws for malformed IDs without valid team-number pattern", () => {
		expect(() => extractLinearIdentifier("linear-some-other-format")).toThrow("Invalid Linear task ID format");
	});

	it("throws for empty prefix after linear-", () => {
		expect(() => extractLinearIdentifier("linear-")).toThrow("Invalid Linear task ID format");
	});

	it("throws for garbage input", () => {
		expect(() => extractLinearIdentifier("garbage")).toThrow("Invalid Linear task ID format");
	});

	it("throws for double-prefixed IDs", () => {
		expect(() => extractLinearIdentifier("linear-linear-LIN-123")).toThrow("Invalid Linear task ID format");
	});
});
