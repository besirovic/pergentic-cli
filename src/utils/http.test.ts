import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchWithRetry, HttpError, parseRetryAfterMs } from "./http";

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

	it("respects Retry-After header with integer seconds", async () => {
		const sleepMod = await import("./sleep");
		const sleepSpy = vi.spyOn(sleepMod, "sleep").mockResolvedValue(undefined);

		vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				new Response("rate limited", {
					status: 429,
					headers: { "Retry-After": "5" },
				}),
			)
			.mockResolvedValueOnce(new Response("ok", { status: 200 }));

		const res = await fetchWithRetry(
			"https://example.com/api",
			{},
			{ maxRetries: 1, baseDelayMs: 10 },
		);
		expect(res.ok).toBe(true);
		expect(sleepSpy).toHaveBeenCalledWith(5000);
	});

	it("respects Retry-After header with HTTP-date", async () => {
		const sleepMod = await import("./sleep");
		const sleepSpy = vi.spyOn(sleepMod, "sleep").mockResolvedValue(undefined);
		// Set a fixed "now" so the delta is predictable
		vi.useFakeTimers({ now: new Date("2025-10-21T07:28:00Z") });

		vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				new Response("rate limited", {
					status: 429,
					headers: { "Retry-After": "Wed, 21 Oct 2025 07:28:10 GMT" },
				}),
			)
			.mockResolvedValueOnce(new Response("ok", { status: 200 }));

		const res = await fetchWithRetry(
			"https://example.com/api",
			{},
			{ maxRetries: 1, baseDelayMs: 10 },
		);
		expect(res.ok).toBe(true);
		// Should sleep ~10 seconds (10_000ms)
		expect(sleepSpy).toHaveBeenCalledWith(10_000);
		vi.useRealTimers();
	});

	it("falls back to exponential backoff on garbage Retry-After", async () => {
		const sleepMod = await import("./sleep");
		const sleepSpy = vi.spyOn(sleepMod, "sleep").mockResolvedValue(undefined);
		vi.spyOn(Math, "random").mockReturnValue(0);

		vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				new Response("rate limited", {
					status: 429,
					headers: { "Retry-After": "not-a-date-or-number" },
				}),
			)
			.mockResolvedValueOnce(new Response("ok", { status: 200 }));

		const res = await fetchWithRetry(
			"https://example.com/api",
			{},
			{ maxRetries: 1, baseDelayMs: 100 },
		);
		expect(res.ok).toBe(true);
		// attempt=0: baseDelayMs * 2^0 + 0 jitter = 100
		expect(sleepSpy).toHaveBeenCalledWith(100);
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

describe("parseRetryAfterMs", () => {
	it("parses integer seconds", () => {
		expect(parseRetryAfterMs("5")).toBe(5000);
		expect(parseRetryAfterMs("0")).toBe(0);
		expect(parseRetryAfterMs("120")).toBe(120_000);
	});

	it("parses HTTP-date", () => {
		vi.useFakeTimers({ now: new Date("2025-10-21T07:28:00Z") });
		expect(parseRetryAfterMs("Wed, 21 Oct 2025 07:28:10 GMT")).toBe(10_000);
		vi.useRealTimers();
	});

	it("returns undefined for garbage", () => {
		expect(parseRetryAfterMs("not-a-date-or-number")).toBeUndefined();
		expect(parseRetryAfterMs("")).toBeUndefined();
	});

	it("clamps past dates to 0", () => {
		vi.useFakeTimers({ now: new Date("2025-10-21T08:00:00Z") });
		expect(parseRetryAfterMs("Wed, 21 Oct 2025 07:00:00 GMT")).toBe(0);
		vi.useRealTimers();
	});
});
