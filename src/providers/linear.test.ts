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

	it("falls back to simple replace for unexpected formats", () => {
		expect(extractLinearIdentifier("linear-some-other-format")).toBe("some-other-format");
	});
});
