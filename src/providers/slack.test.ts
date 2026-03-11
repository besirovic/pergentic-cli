import { describe, it, expect, vi, beforeEach } from "vitest";
import { SlackProvider } from "./slack";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Minimal WebSocket stub
class MockWebSocket {
	onmessage: ((event: { data: string }) => void) | null = null;
	onerror: ((err: unknown) => void) | null = null;
	onclose: (() => void) | null = null;
	close = vi.fn();
	send = vi.fn();
}

vi.stubGlobal("WebSocket", MockWebSocket);

function makeSuccessResponse() {
	return Promise.resolve({
		json: () => Promise.resolve({ ok: true, url: "wss://fake.slack.com" }),
	});
}

function makeFailResponse() {
	return Promise.resolve({
		json: () => Promise.resolve({ ok: false }),
	});
}

describe("SlackProvider", () => {
	let provider: SlackProvider;

	beforeEach(() => {
		vi.clearAllMocks();
		provider = new SlackProvider("xoxb-bot", "xapp-app");
	});

	it("connects successfully on first poll", async () => {
		mockFetch.mockReturnValueOnce(makeSuccessResponse());

		const tasks = await provider.poll({} as never);

		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect(tasks).toEqual([]);
	});

	it("deduplicates concurrent connect() calls", async () => {
		// Make fetch slow enough that both calls overlap
		let resolveFirst!: (v: unknown) => void;
		mockFetch.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveFirst = resolve;
			})
		);

		const p1 = provider.connect();
		const p2 = provider.connect();

		// Resolve the single fetch call
		resolveFirst({
			json: () => Promise.resolve({ ok: true, url: "wss://fake.slack.com" }),
		});

		await Promise.all([p1, p2]);

		// fetch should only have been called once
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	it("concurrent poll() calls result in only one connect()", async () => {
		let resolveFirst!: (v: unknown) => void;
		mockFetch.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveFirst = resolve;
			})
		);

		const p1 = provider.poll({} as never);
		const p2 = provider.poll({} as never);

		resolveFirst({
			json: () => Promise.resolve({ ok: true, url: "wss://fake.slack.com" }),
		});

		const [tasks1, tasks2] = await Promise.all([p1, p2]);

		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect(tasks1).toEqual([]);
		expect(tasks2).toEqual([]);
	});

	it("connectionId increments only once per actual connection", async () => {
		let resolveFirst!: (v: unknown) => void;
		mockFetch.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveFirst = resolve;
			})
		);

		const p1 = provider.connect();
		const p2 = provider.connect();

		resolveFirst({
			json: () => Promise.resolve({ ok: true, url: "wss://fake.slack.com" }),
		});

		await Promise.all([p1, p2]);

		// Access private field for verification
		expect((provider as any).connectionId).toBe(1);
	});

	it("clears connectPromise in finally block on error", async () => {
		mockFetch.mockReturnValueOnce(makeFailResponse());

		await expect(provider.connect()).rejects.toThrow(
			"Failed to open Slack Socket Mode connection"
		);

		// connectPromise should be cleared, allowing a retry
		expect((provider as any).connectPromise).toBeNull();

		// Retry should work
		mockFetch.mockReturnValueOnce(makeSuccessResponse());
		await provider.connect();
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it("does not discard messages from the active connection", async () => {
		mockFetch.mockReturnValueOnce(makeSuccessResponse());
		await provider.connect();

		const ws = (provider as any).ws as MockWebSocket;

		// Simulate an incoming app_mention event
		ws.onmessage!({
			data: JSON.stringify({
				type: "events_api",
				envelope_id: "env-1",
				payload: {
					event: {
						type: "app_mention",
						text: "<@U123> fix the bug",
						channel: "C001",
						user: "U456",
						ts: "1234567890.000001",
					},
				},
			}),
		});

		const tasks = await provider.poll({} as never);
		expect(tasks).toHaveLength(1);
		expect(tasks[0].id).toBe("slack-1234567890.000001");
		expect(tasks[0].title).toBe("fix the bug");
	});

	it("single-caller behavior is unchanged", async () => {
		mockFetch.mockReturnValueOnce(makeSuccessResponse());

		// First poll connects
		const tasks1 = await provider.poll({} as never);
		expect(tasks1).toEqual([]);
		expect(mockFetch).toHaveBeenCalledTimes(1);

		// Second poll reuses existing connection (no additional fetch)
		const tasks2 = await provider.poll({} as never);
		expect(tasks2).toEqual([]);
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});
});
