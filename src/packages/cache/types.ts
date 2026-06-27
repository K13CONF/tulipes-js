/**
 * Storage-agnostic cache contract. Implementations serialize values themselves;
 * callers work with plain objects. Keep it small — add methods only when a real
 * use case needs them.
 */
export interface Cache {
    /** Returns the cached value, or `null` if absent/expired. */
    get<T>(key: string): Promise<T | null>
    /** Stores a value, optionally expiring after `ttlSeconds`. */
    set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>
    /** Removes a key (no-op if absent). */
    del(key: string): Promise<void>
    /**
     * Returns the cached value, or computes it with `producer`, caches it for
     * `ttlSeconds`, and returns it (read-through).
     */
    wrap<T>(key: string, ttlSeconds: number, producer: () => Promise<T>): Promise<T>
}
