import { describe, it, expect } from "vitest";
import { parseOwnerRepo } from "./git";

describe("parseOwnerRepo", () => {
	it("parses HTTPS URL", () => {
		const result = parseOwnerRepo("https://github.com/owner/repo.git");
		expect(result).toEqual({ owner: "owner", repo: "repo", hostname: "github.com" });
	});

	it("parses HTTPS URL without .git", () => {
		const result = parseOwnerRepo("https://github.com/owner/repo");
		expect(result).toEqual({ owner: "owner", repo: "repo", hostname: "github.com" });
	});

	it("parses SSH URL", () => {
		const result = parseOwnerRepo("git@github.com:owner/repo.git");
		expect(result).toEqual({ owner: "owner", repo: "repo", hostname: "github.com" });
	});

	it("parses SSH URL without .git", () => {
		const result = parseOwnerRepo("git@github.com:owner/repo");
		expect(result).toEqual({ owner: "owner", repo: "repo", hostname: "github.com" });
	});

	it("handles owner/repo with dots and hyphens", () => {
		const result = parseOwnerRepo("https://github.com/my-org/my-repo.js");
		expect(result).toEqual({ owner: "my-org", repo: "my-repo.js", hostname: "github.com" });
	});

	it("parses GitHub Enterprise HTTPS URL", () => {
		const result = parseOwnerRepo("https://github.mycompany.com/org/repo");
		expect(result).toEqual({ owner: "org", repo: "repo", hostname: "github.mycompany.com" });
	});

	it("parses GitHub Enterprise HTTPS URL with .git", () => {
		const result = parseOwnerRepo("https://github.mycompany.com/org/repo.git");
		expect(result).toEqual({ owner: "org", repo: "repo", hostname: "github.mycompany.com" });
	});

	it("parses GitHub Enterprise SSH URL", () => {
		const result = parseOwnerRepo("git@github.mycompany.com:org/repo.git");
		expect(result).toEqual({ owner: "org", repo: "repo", hostname: "github.mycompany.com" });
	});

	it("parses GitHub Enterprise SSH URL without .git", () => {
		const result = parseOwnerRepo("git@github.mycompany.com:org/repo");
		expect(result).toEqual({ owner: "org", repo: "repo", hostname: "github.mycompany.com" });
	});

	it("throws on invalid URL", () => {
		expect(() => parseOwnerRepo("not-a-url")).toThrow(
			"Cannot parse owner/repo",
		);
	});

	it("throws on URL without enough path segments", () => {
		expect(() => parseOwnerRepo("https://github.com/")).toThrow(
			"Cannot parse owner/repo from path",
		);
	});
});
