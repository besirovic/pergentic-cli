import { describe, it, expect, afterEach } from "vitest";
import { readLastLines, readLastLinesChunked } from "./read-last-lines";
import {
	writeFileSync,
	unlinkSync,
	openSync,
	closeSync,
	fstatSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeTempPath(): string {
	return join(
		tmpdir(),
		`rll-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
	);
}

describe("readLastLines", () => {
	const files: string[] = [];

	function createFile(content: string): string {
		const path = makeTempPath();
		writeFileSync(path, content);
		files.push(path);
		return path;
	}

	afterEach(() => {
		for (const f of files.splice(0)) {
			try {
				unlinkSync(f);
			} catch {}
		}
	});

	it("returns empty array for empty file", () => {
		const path = createFile("");
		expect(readLastLines(path, 10)).toEqual([]);
	});

	it("returns single line", () => {
		const path = createFile("hello world");
		expect(readLastLines(path, 10)).toEqual(["hello world"]);
	});

	it("returns last N lines", () => {
		const path = createFile("line1\nline2\nline3\nline4\nline5");
		expect(readLastLines(path, 3)).toEqual(["line3", "line4", "line5"]);
	});

	it("returns all lines when count exceeds line count", () => {
		const path = createFile("a\nb\nc");
		expect(readLastLines(path, 100)).toEqual(["a", "b", "c"]);
	});

	it("handles file with trailing newline", () => {
		const path = createFile("line1\nline2\n");
		expect(readLastLines(path, 10)).toEqual(["line1", "line2"]);
	});

	it("handles file smaller than chunkSize (8KB)", () => {
		const lines = Array.from({ length: 5 }, (_, i) => `line${i + 1}`);
		const path = createFile(lines.join("\n"));
		expect(readLastLines(path, 3)).toEqual(["line3", "line4", "line5"]);
	});
});

describe("readLastLinesChunked", () => {
	const SMALL_CHUNK = 16; // tiny chunk to exercise edge cases without large files
	const fds: number[] = [];
	const files: string[] = [];

	function createFileAndOpen(content: string): {
		fd: number;
		size: number;
	} {
		const path = makeTempPath();
		writeFileSync(path, content);
		files.push(path);
		const fd = openSync(path, "r");
		fds.push(fd);
		const { size } = fstatSync(fd);
		return { fd, size };
	}

	afterEach(() => {
		for (const fd of fds.splice(0)) {
			try {
				closeSync(fd);
			} catch {}
		}
		for (const f of files.splice(0)) {
			try {
				unlinkSync(f);
			} catch {}
		}
	});

	it("handles file smaller than chunkSize without negative position", () => {
		// "tiny" is 4 bytes, less than SMALL_CHUNK=16
		const { fd, size } = createFileAndOpen("tiny");
		expect(size).toBeLessThan(SMALL_CHUNK);
		expect(() => readLastLinesChunked(fd, size, 10, SMALL_CHUNK)).not.toThrow();
		const result = readLastLinesChunked(fd, size, 10, SMALL_CHUNK);
		expect(result).toEqual(["tiny"]);
	});

	it("handles file exactly chunkSize bytes", () => {
		// "aaa\nbbb\nccc\nddd\n" = 16 bytes exactly
		const content = "aaa\nbbb\nccc\nddd\n";
		expect(Buffer.byteLength(content)).toBe(SMALL_CHUNK);
		const { fd, size } = createFileAndOpen(content);
		const result = readLastLinesChunked(fd, size, 10, SMALL_CHUNK);
		expect(result).toEqual(["aaa", "bbb", "ccc", "ddd"]);
	});

	it("handles file chunkSize + 1 bytes (spans two chunks)", () => {
		// "aaa\nbbb\nccc\nddd\ne" = 17 bytes
		const content = "aaa\nbbb\nccc\nddd\ne";
		expect(Buffer.byteLength(content)).toBe(SMALL_CHUNK + 1);
		const { fd, size } = createFileAndOpen(content);
		const result = readLastLinesChunked(fd, size, 10, SMALL_CHUNK);
		expect(result).toEqual(["aaa", "bbb", "ccc", "ddd", "e"]);
	});

	it("returns correct last N lines across multiple chunks", () => {
		// 20 lines of "lineXX\n" each — spans many 16-byte chunks
		const lines = Array.from(
			{ length: 20 },
			(_, i) => `line${String(i + 1).padStart(2, "0")}`,
		);
		const { fd, size } = createFileAndOpen(lines.join("\n"));
		const result = readLastLinesChunked(fd, size, 5, SMALL_CHUNK);
		expect(result).toEqual(lines.slice(-5));
	});

	it("returns all lines when count exceeds total lines", () => {
		const content = "x\ny\nz";
		const { fd, size } = createFileAndOpen(content);
		const result = readLastLinesChunked(fd, size, 100, SMALL_CHUNK);
		expect(result).toEqual(["x", "y", "z"]);
	});

	it("handles file with only newlines", () => {
		const content = "\n\n\n";
		const { fd, size } = createFileAndOpen(content);
		const result = readLastLinesChunked(fd, size, 10, SMALL_CHUNK);
		expect(result).toEqual([]);
	});
});
