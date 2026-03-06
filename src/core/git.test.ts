import { describe, it, expect } from "vitest";
import { parseOwnerRepo } from "./git";

describe("parseOwnerRepo", () => {
	it("parses HTTPS URL", () => {
		const result = parseOwnerRepo("https://github.com/owner/repo.git");
		expect(result).toEqual({ owner: "owner", repo: "repo" });
	});

	it("parses HTTPS URL without .git", () => {
		const result = parseOwnerRepo("https://github.com/owner/repo");
		expect(result).toEqual({ owner: "owner", repo: "repo" });
	});

	it("parses SSH URL", () => {
		const result = parseOwnerRepo("git@github.com:owner/repo.git");
		expect(result).toEqual({ owner: "owner", repo: "repo" });
	});

	it("parses SSH URL without .git", () => {
		const result = parseOwnerRepo("git@github.com:owner/repo");
		expect(result).toEqual({ owner: "owner", repo: "repo" });
	});

	it("handles owner/repo with dots and hyphens", () => {
		const result = parseOwnerRepo("https://github.com/my-org/my-repo.js");
		expect(result).toEqual({ owner: "my-org", repo: "my-repo.js" });
	});

	it("throws on non-GitHub URL", () => {
		expect(() => parseOwnerRepo("https://gitlab.com/owner/repo")).toThrow(
			"Not a GitHub URL",
		);
	});

	it("throws on invalid URL", () => {
		expect(() => parseOwnerRepo("not-a-url")).toThrow(
			"Cannot parse owner/repo",
		);
	});

	it("throws on GitHub URL without enough path segments", () => {
		expect(() => parseOwnerRepo("https://github.com/")).toThrow(
			"Cannot parse owner/repo from path",
		);
	});
});
