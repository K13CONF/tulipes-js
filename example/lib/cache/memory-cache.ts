import { BaseCache } from "./types.js";

interface Entry {
  value: unknown;
  /** Epoch ms when this entry expires, or `null` for no expiry. */
  expiresAt: number | null;
}

/**
 * In-process cache backed by a `Map`. For tests and local runs without
 * Redis — not shared across processes (each worker has its own store).
 *
 * Bounded: past `maxEntries` the least-recently-used key is evicted. LRU
 * order rides on Map insertion order — hits re-insert their key at the tail.
 */
export class MemoryCache extends BaseCache {
  readonly #store = new Map<string, Entry>();
  readonly #maxEntries: number;

  constructor(maxEntries = 10_000) {
    super();
    this.#maxEntries = maxEntries;
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.#store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.#store.delete(key);
      return null;
    }
    // Refresh recency: delete + re-set moves the key to the Map's tail.
    this.#store.delete(key);
    this.#store.set(key, entry);
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const expiresAt =
      ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null;
    this.#store.delete(key);
    this.#store.set(key, { value, expiresAt });

    while (this.#store.size > this.#maxEntries) {
      // Oldest key = head of the Map's insertion order.
      this.#store.delete(this.#store.keys().next().value!);
    }
  }

  async del(key: string): Promise<void> {
    this.#store.delete(key);
  }
}
