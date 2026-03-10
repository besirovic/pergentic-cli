import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { createDaemonServer } from "./daemon-server";

function request(
	port: number,
	method: string,
	path: string,
	body?: string,
): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const req = http.request({ hostname: "127.0.0.1", port, method, path }, (res) => {
			let data = "";
			res.on("data", (chunk) => (data += chunk));
			res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
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
});
