import { describe, it, expect } from "vitest";
import { sleep, cancellableSleep } from "./sleep";

describe("sleep", () => {
	it("resolves after the given duration", async () => {
		const start = Date.now();
		await sleep(50);
		expect(Date.now() - start).toBeGreaterThanOrEqual(40);
	});
});

describe("cancellableSleep", () => {
	it("behaves like sleep when no signal is provided", async () => {
		const start = Date.now();
		await cancellableSleep(50);
		expect(Date.now() - start).toBeGreaterThanOrEqual(40);
	});

	it("resolves immediately when signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const start = Date.now();
		await cancellableSleep(60000, controller.signal);
		expect(Date.now() - start).toBeLessThan(50);
	});

	it("resolves early when signal is aborted during sleep", async () => {
		const controller = new AbortController();
		const start = Date.now();
		const promise = cancellableSleep(60000, controller.signal);
		setTimeout(() => controller.abort(), 30);
		await promise;
		expect(Date.now() - start).toBeLessThan(200);
	});

	it("resolves normally when signal is never aborted", async () => {
		const controller = new AbortController();
		const start = Date.now();
		await cancellableSleep(50, controller.signal);
		expect(Date.now() - start).toBeGreaterThanOrEqual(40);
	});
});
