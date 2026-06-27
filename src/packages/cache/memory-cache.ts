import type { Cache } from "./types.js"

interface Entry {
    value: unknown
    /** Epoch ms when this entry expires, or `null` for no expiry. */
    expiresAt: number | null
}

/**
 * In-process {@link Cache} backed by a `Map`. Intended for tests and local runs
 * without Redis — not safe across processes (each worker has its own store) and
 * unbounded, so don't use it in production.
 */
export class MemoryCache implements Cache {
    private readonly store = new Map<string, Entry>()

    async get<T>(key: string): Promise<T | null> {
        const entry = this.store.get(key)
        if (!entry) return null
        if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
            this.store.delete(key)
            return null
        }
        return entry.value as T
    }

    async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
        const expiresAt = ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null
        this.store.set(key, { value, expiresAt })
    }

    async del(key: string): Promise<void> {
        this.store.delete(key)
    }

    async wrap<T>(key: string, ttlSeconds: number, producer: () => Promise<T>): Promise<T> {
        const cached = await this.get<T>(key)
        if (cached !== null) return cached

        const fresh = await producer()
        await this.set(key, fresh, ttlSeconds)
        return fresh
    }
}
