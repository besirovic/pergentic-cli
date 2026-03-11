/**
 * Simple LRU (Least Recently Used) cache backed by a Map.
 * Map preserves insertion order in JS, so the first key is the oldest.
 * On get: delete + re-set moves the entry to the end (most recent).
 * On set: if at capacity, delete the first key (least recent).
 */
export class LRUCache<K, V> {
  private map = new Map<K, V>();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    if (maxSize < 1) throw new Error("LRUCache maxSize must be >= 1");
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Move to most-recently-used position
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    // If key exists, delete first so re-set moves it to end
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      // Evict least-recently-used (first key)
      const oldest = this.map.keys().next().value as K;
      this.map.delete(oldest);
    }
    this.map.set(key, value);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
