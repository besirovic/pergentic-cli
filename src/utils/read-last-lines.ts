import { openSync, fstatSync, readSync, readFileSync, closeSync } from "node:fs";
import { LIMITS } from "../config/constants";

/**
 * Reads the last N non-empty lines from a file.
 * For files <= MAX_SAFE_LOG_READ_BYTES, reads the whole file.
 * For larger files, reads chunks from the end to avoid OOM.
 */
export function readLastLines(filePath: string, count: number): string[] {
	const fd = openSync(filePath, "r");
	try {
		const stat = fstatSync(fd);
		const fileSize = stat.size;

		if (fileSize === 0) return [];

		if (fileSize <= LIMITS.MAX_SAFE_LOG_READ_BYTES) {
			const content = readFileSync(filePath, "utf-8");
			return content.split("\n").filter(Boolean).slice(-count);
		}

		return readLastLinesChunked(fd, fileSize, count);
	} finally {
		closeSync(fd);
	}
}

function readLastLinesChunked(
	fd: number,
	fileSize: number,
	count: number,
): string[] {
	const chunkSize = LIMITS.LOG_READ_CHUNK_BYTES;
	const lines: string[] = [];
	let remaining = "";
	let position = fileSize;

	while (position > 0 && lines.length < count) {
		const readSize = Math.min(chunkSize, position);
		position -= readSize;

		const buffer = Buffer.alloc(readSize);
		readSync(fd, buffer, 0, readSize, position);
		const chunk = buffer.toString("utf-8");

		const text = chunk + remaining;
		const parts = text.split("\n");

		// First element is a partial line (unless we're at file start)
		remaining = parts[0];

		// Process lines from end to start (skip first partial)
		for (let i = parts.length - 1; i >= 1; i--) {
			if (parts[i].length > 0) {
				lines.push(parts[i]);
				if (lines.length >= count) break;
			}
		}
	}

	// Handle the very first line of the file
	if (lines.length < count && remaining.length > 0) {
		lines.push(remaining);
	}

	// Lines were collected in reverse order
	lines.reverse();
	return lines;
}
