import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseOwnerRepo, commitAll, pushBranch, amendAndForcePush, pullBranch } from "./git";

vi.mock("simple-git");

import simpleGit from "simple-git";

const mockGitBase = {
  revparse: vi.fn().mockResolvedValue("main"),
  log: vi.fn().mockResolvedValue({ latest: { hash: "abc1234" } }),
  add: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue(undefined),
  push: vi.fn().mockResolvedValue(undefined),
  pull: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(simpleGit).mockReturnValue(mockGitBase as never);
  mockGitBase.revparse.mockResolvedValue("main");
  mockGitBase.log.mockResolvedValue({ latest: { hash: "abc1234" } });
  mockGitBase.add.mockResolvedValue(undefined);
  mockGitBase.commit.mockResolvedValue(undefined);
  mockGitBase.push.mockResolvedValue(undefined);
  mockGitBase.pull.mockResolvedValue(undefined);
});

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

describe("commitAll", () => {
  it("resolves when git succeeds", async () => {
    await expect(commitAll("/wt", "fix: something")).resolves.toBeUndefined();
    expect(mockGitBase.add).toHaveBeenCalled();
    expect(mockGitBase.commit).toHaveBeenCalledWith("fix: something");
  });

  it("throws with branch/commit context when git add fails", async () => {
    mockGitBase.add.mockRejectedValue(new Error("dirty working tree"));
    await expect(commitAll("/wt", "fix: something")).rejects.toThrow(
      "Git commit failed on branch 'main' (last commit: abc1234): dirty working tree",
    );
  });

  it("throws with branch/commit context when git commit fails", async () => {
    mockGitBase.commit.mockRejectedValue(new Error("nothing to commit"));
    await expect(commitAll("/wt", "fix: something")).rejects.toThrow(
      "Git commit failed on branch 'main' (last commit: abc1234): nothing to commit",
    );
  });

  it("includes 'unknown' context when git context fetch also fails", async () => {
    mockGitBase.add.mockRejectedValue(new Error("corrupt repo"));
    mockGitBase.revparse.mockRejectedValue(new Error("not a git repo"));
    await expect(commitAll("/wt", "fix: something")).rejects.toThrow(
      "Git commit failed on branch 'unknown' (last commit: unknown): corrupt repo",
    );
  });
});

describe("pushBranch", () => {
  it("resolves when push succeeds", async () => {
    await expect(pushBranch("/wt", "feature/x")).resolves.toBeUndefined();
    expect(mockGitBase.push).toHaveBeenCalledWith("origin", "feature/x");
  });

  it("throws with context when push is rejected", async () => {
    mockGitBase.push.mockRejectedValue(new Error("rejected: non-fast-forward"));
    await expect(pushBranch("/wt", "feature/x")).rejects.toThrow(
      "Git push of 'feature/x' failed on branch 'main' (last commit: abc1234): rejected: non-fast-forward",
    );
  });
});

describe("amendAndForcePush", () => {
  it("resolves when amend and force-push succeed", async () => {
    await expect(amendAndForcePush("/wt", "feature/x")).resolves.toBeUndefined();
    expect(mockGitBase.add).toHaveBeenCalledWith("-A");
    expect(mockGitBase.push).toHaveBeenCalledWith("origin", "feature/x", ["--force"]);
  });

  it("throws with context when amend commit fails", async () => {
    mockGitBase.commit.mockRejectedValue(new Error("nothing to amend"));
    await expect(amendAndForcePush("/wt", "feature/x")).rejects.toThrow(
      "Git amend/force-push of 'feature/x' failed on branch 'main' (last commit: abc1234): nothing to amend",
    );
  });

  it("throws with context when force-push is rejected", async () => {
    mockGitBase.push.mockRejectedValue(new Error("remote rejected force push"));
    await expect(amendAndForcePush("/wt", "feature/x")).rejects.toThrow(
      "Git amend/force-push of 'feature/x' failed on branch 'main' (last commit: abc1234): remote rejected force push",
    );
  });
});

describe("pullBranch", () => {
  it("resolves when pull succeeds", async () => {
    await expect(pullBranch("/wt", "main")).resolves.toBeUndefined();
    expect(mockGitBase.pull).toHaveBeenCalledWith("origin", "main");
  });

  it("throws with context when pull has merge conflict", async () => {
    mockGitBase.pull.mockRejectedValue(new Error("merge conflict"));
    await expect(pullBranch("/wt", "main")).rejects.toThrow(
      "Git pull of 'main' failed on branch 'main' (last commit: abc1234): merge conflict",
    );
  });
});
