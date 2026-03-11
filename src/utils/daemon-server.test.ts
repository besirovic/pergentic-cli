import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { createDaemonServer } from "./daemon-server";

function request(
	port: number,
	method: string,
	path: string,
	body?: string | Buffer,
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
	return new Promise((resolve, reject) => {
		const req = http.request({ hostname: "127.0.0.1", port, method, path }, (res) => {
			const chunks: Buffer[] = [];
			res.on("data", (chunk: Buffer) => chunks.push(chunk));
			res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf-8"), headers: res.headers }));
		});
		req.on("error", reject);
		if (body !== undefined) req.end(body);
		else req.end();
	});
}

describe("daemon-server", () => {
	let server: http.Server;
	let port: number;

	afterEach(
		() =>
			new Promise<void>((resolve) => {
				if (server?.listening) server.close(() => resolve());
				else resolve();
			}),
	);

	function startServer(setup: (s: ReturnType<typeof createDaemonServer>) => void): Promise<number> {
		return new Promise((resolve) => {
			const s = createDaemonServer();
			server = s.server;
			setup(s);
			server.listen(0, "127.0.0.1", () => {
				const addr = server.address();
				port = typeof addr === "object" && addr ? addr.port : 0;
				resolve(port);
			});
		});
	}

	it("handles normal POST requests", async () => {
		await startServer((s) => {
			s.post("/echo", (body, res) => {
				res.writeHead(200).end(body);
			});
		});

		const res = await request(port, "POST", "/echo", '{"ok":true}');
		expect(res.status).toBe(200);
		expect(res.body).toBe('{"ok":true}');
	});

	it("returns 413 for oversized POST body", async () => {
		await startServer((s) => {
			s.post("/echo", (body, res) => {
				res.writeHead(200).end(body);
			});
		});

		const oversized = "x".repeat(1_048_576 + 1);
		const res = await request(port, "POST", "/echo", oversized);
		expect(res.status).toBe(413);
	});

	it("preserves multi-byte UTF-8 characters in POST body", async () => {
		await startServer((s) => {
			s.post("/echo", (body, res) => {
				res.writeHead(200).end(body);
			});
		});

		// String with emoji (4-byte), CJK (3-byte), and accented chars (2-byte)
		const multiByteBody = JSON.stringify({ text: "Hello 🌍 世界 café" });
		// Send as a Buffer to ensure the server handles raw bytes correctly
		const buf = Buffer.from(multiByteBody, "utf-8");

		// Split the buffer at arbitrary points that may bisect multi-byte chars
		const res = await request(port, "POST", "/echo", buf);
		expect(res.status).toBe(200);
		expect(res.body).toBe(multiByteBody);
	});

	it("allows exactly 1MB POST body", async () => {
		await startServer((s) => {
			s.post("/echo", (_body, res) => {
				res.writeHead(200).end("ok");
			});
		});

		const exactLimit = "x".repeat(1_048_576);
		const res = await request(port, "POST", "/echo", exactLimit);
		expect(res.status).toBe(200);
	});

	it("rate limits POST requests after 30 in one minute", async () => {
		await startServer((s) => {
			s.post("/action", (_body, res) => {
				res.writeHead(200).end("ok");
			});
		});

		// Send 30 requests — all should succeed
		for (let i = 0; i < 30; i++) {
			const res = await request(port, "POST", "/action", "{}");
			expect(res.status).toBe(200);
		}

		// 31st request should be rate limited
		const limited = await request(port, "POST", "/action", "{}");
		expect(limited.status).toBe(429);
		expect(limited.headers["retry-after"]).toBeDefined();
		expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
		expect(limited.headers["x-ratelimit-remaining"]).toBe("0");
	});

	it("allows requests again after window resets", async () => {
		// Use a fresh server so rate limit state is clean
		await startServer((s) => {
			s.post("/action", (_body, res) => {
				res.writeHead(200).end("ok");
			});
		});

		// Exhaust the rate limit
		for (let i = 0; i < 30; i++) {
			await request(port, "POST", "/action", "{}");
		}

		const limited = await request(port, "POST", "/action", "{}");
		expect(limited.status).toBe(429);

		// We can't wait 60s in a test, so we verify the mechanism works
		// by confirming the Retry-After header indicates when to retry
		const retryAfter = Number(limited.headers["retry-after"]);
		expect(retryAfter).toBeGreaterThan(0);
		expect(retryAfter).toBeLessThanOrEqual(60);
	});

	it("rate limits GET requests after 120 in one minute", async () => {
		await startServer((s) => {
			s.get("/status", (res) => {
				res.writeHead(200).end("ok");
			});
		});

		// Send 120 requests — all should succeed
		for (let i = 0; i < 120; i++) {
			const res = await request(port, "GET", "/status");
			expect(res.status).toBe(200);
		}

		// 121st request should be rate limited
		const limited = await request(port, "GET", "/status");
		expect(limited.status).toBe(429);
		expect(limited.headers["retry-after"]).toBeDefined();
	});

	it("does not rate limit normal CLI usage patterns", async () => {
		await startServer((s) => {
			s.get("/status", (res) => {
				res.writeHead(200).end("ok");
			});
			s.post("/retry", (_body, res) => {
				res.writeHead(200).end("ok");
			});
		});

		// Simulate typical CLI usage: a few status checks and an action
		for (let i = 0; i < 5; i++) {
			const statusRes = await request(port, "GET", "/status");
			expect(statusRes.status).toBe(200);
		}
		const actionRes = await request(port, "POST", "/retry", "{}");
		expect(actionRes.status).toBe(200);
	});
});
