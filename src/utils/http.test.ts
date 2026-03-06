import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchWithRetry, HttpError } from "./http";

describe("fetchWithRetry", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns response on success", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response("ok", { status: 200 }),
		);

		const res = await fetchWithRetry("https://example.com/api");
		expect(res.ok).toBe(true);
		expect(await res.text()).toBe("ok");
	});

	it("throws HttpError on non-retryable status", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response("not found", { status: 404 }),
		);

		await expect(
			fetchWithRetry("https://example.com/api", {}, { maxRetries: 0 }),
		).rejects.toThrow(HttpError);
	});

	it("retries on 500 and succeeds", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(new Response("error", { status: 500 }))
			.mockResolvedValueOnce(new Response("ok", { status: 200 }));

		const res = await fetchWithRetry(
			"https://example.com/api",
			{},
			{ maxRetries: 1, baseDelayMs: 10 },
		);
		expect(res.ok).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("throws after exhausting retries", async () => {
		vi.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("error", { status: 500 }));

		await expect(
			fetchWithRetry(
				"https://example.com/api",
				{},
				{ maxRetries: 2, baseDelayMs: 10 },
			),
		).rejects.toThrow(HttpError);
	});

	it("retries on network error", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch")
			.mockRejectedValueOnce(new TypeError("fetch failed"))
			.mockResolvedValueOnce(new Response("ok", { status: 200 }));

		const res = await fetchWithRetry(
			"https://example.com/api",
			{},
			{ maxRetries: 1, baseDelayMs: 10 },
		);
		expect(res.ok).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
