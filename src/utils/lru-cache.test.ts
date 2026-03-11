import { describe, it, expect } from "vitest";
import { LRUCache } from "./lru-cache";

describe("LRUCache", () => {
	it("stores and retrieves values", () => {
		const cache = new LRUCache<string, number>(3);
		cache.set("a", 1);
		cache.set("b", 2);
		expect(cache.get("a")).toBe(1);
		expect(cache.get("b")).toBe(2);
		expect(cache.size).toBe(2);
	});

	it("returns undefined for missing keys", () => {
		const cache = new LRUCache<string, number>(3);
		expect(cache.get("missing")).toBeUndefined();
	});

	it("evicts the oldest entry when at capacity", () => {
		const cache = new LRUCache<string, number>(3);
		cache.set("a", 1);
		cache.set("b", 2);
		cache.set("c", 3);
		// At capacity, inserting "d" should evict "a"
		cache.set("d", 4);
		expect(cache.get("a")).toBeUndefined();
		expect(cache.get("b")).toBe(2);
		expect(cache.get("c")).toBe(3);
		expect(cache.get("d")).toBe(4);
		expect(cache.size).toBe(3);
	});

	it("get() promotes entry to most-recently-used, preventing eviction", () => {
		const cache = new LRUCache<string, number>(3);
		cache.set("a", 1);
		cache.set("b", 2);
		cache.set("c", 3);
		// Access "a" to promote it
		cache.get("a");
		// Insert "d" — should evict "b" (now the oldest), not "a"
		cache.set("d", 4);
		expect(cache.get("a")).toBe(1);
		expect(cache.get("b")).toBeUndefined();
		expect(cache.get("c")).toBe(3);
		expect(cache.get("d")).toBe(4);
	});

	it("set() on existing key updates value and promotes it", () => {
		const cache = new LRUCache<string, number>(3);
		cache.set("a", 1);
		cache.set("b", 2);
		cache.set("c", 3);
		// Update "a" — promotes it
		cache.set("a", 10);
		cache.set("d", 4);
		// "b" should be evicted, not "a"
		expect(cache.get("a")).toBe(10);
		expect(cache.get("b")).toBeUndefined();
		expect(cache.size).toBe(3);
	});

	it("has() returns correct boolean", () => {
		const cache = new LRUCache<string, number>(3);
		cache.set("a", 1);
		expect(cache.has("a")).toBe(true);
		expect(cache.has("z")).toBe(false);
	});

	it("delete() removes entry", () => {
		const cache = new LRUCache<string, number>(3);
		cache.set("a", 1);
		expect(cache.delete("a")).toBe(true);
		expect(cache.has("a")).toBe(false);
		expect(cache.size).toBe(0);
		expect(cache.delete("a")).toBe(false);
	});

	it("clear() empties the cache", () => {
		const cache = new LRUCache<string, number>(3);
		cache.set("a", 1);
		cache.set("b", 2);
		cache.clear();
		expect(cache.size).toBe(0);
		expect(cache.get("a")).toBeUndefined();
	});

	it("throws on invalid maxSize", () => {
		expect(() => new LRUCache(0)).toThrow("maxSize must be >= 1");
		expect(() => new LRUCache(-1)).toThrow("maxSize must be >= 1");
	});

	it("works with maxSize of 1", () => {
		const cache = new LRUCache<string, number>(1);
		cache.set("a", 1);
		cache.set("b", 2);
		expect(cache.get("a")).toBeUndefined();
		expect(cache.get("b")).toBe(2);
		expect(cache.size).toBe(1);
	});
});
