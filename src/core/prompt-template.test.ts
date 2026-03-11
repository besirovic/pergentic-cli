import { describe, it, expect } from "vitest";
import { resolveTemplate, validateTemplate } from "./prompt-template";
import type { PromptTemplateContext } from "./prompt-template";

const baseContext: PromptTemplateContext = {
	title: "My Title",
	description: "My Description",
	taskId: "task-123",
	source: "linear",
	labels: "bug, urgent",
	priority: "1",
	url: "https://example.com",
	identifier: "LIN-42",
	issueNumber: "7",
	owner: "acme",
	repo: "frontend",
	project: "my-project",
	branch: "main",
	agent: "claude-code",
	date: "2026-01-01",
	timestamp: "2026-01-01T00:00:00.000Z",
};

describe("resolveTemplate", () => {
	it("substitutes known variables", () => {
		expect(resolveTemplate("Title: {title}", baseContext)).toBe("Title: My Title");
	});

	it("leaves unknown variables as-is", () => {
		expect(resolveTemplate("{unknown}", baseContext)).toBe("{unknown}");
	});

	it("preserves {{ as literal {", () => {
		expect(resolveTemplate("{{title}}", baseContext)).toBe("{title}");
	});

	it("preserves }} as literal }", () => {
		expect(resolveTemplate("{{title}}", baseContext)).toBe("{title}");
	});

	it("handles {{escaped}} alongside {substituted}", () => {
		const result = resolveTemplate("Sub: {title} Lit: {{title}}", baseContext);
		expect(result).toBe("Sub: My Title Lit: {title}");
	});

	it("handles double-escaped braces producing literal brace pairs", () => {
		const result = resolveTemplate("{{{{", baseContext);
		expect(result).toBe("{{");
	});

	it("substitutes multiple variables", () => {
		const result = resolveTemplate("{title} by {agent} on {date}", baseContext);
		expect(result).toBe("My Title by claude-code on 2026-01-01");
	});

	it("preserves literal text with no placeholders", () => {
		expect(resolveTemplate("No placeholders here", baseContext)).toBe("No placeholders here");
	});

	it("handles mixed escaped and unescaped in one pass", () => {
		const result = resolveTemplate(
			"Task {{identifier}} is {title}",
			baseContext,
		);
		expect(result).toBe("Task {identifier} is My Title");
	});
});

describe("validateTemplate", () => {
	it("returns empty array for valid template", () => {
		expect(validateTemplate("{title}\n{description}")).toEqual([]);
	});

	it("returns unknown variable names", () => {
		expect(validateTemplate("{unknownVar}")).toEqual(["unknownVar"]);
	});

	it("does not flag escaped braces as unknown variables", () => {
		expect(validateTemplate("{{title}} is literal")).toEqual([]);
	});

	it("does not flag escaped unknown-looking vars", () => {
		expect(validateTemplate("{{customVar}} is literal")).toEqual([]);
	});

	it("still detects real unknown vars alongside escaped braces", () => {
		expect(validateTemplate("{title} {{literal}} {badVar}")).toEqual(["badVar"]);
	});
});
