import type { Redis } from "ioredis"
import type { Cache } from "./types.js"

/**
 * Redis-backed {@link Cache}. Values are JSON-serialized; keys are namespaced by
 * `prefix` so a `FLUSHDB`-free reset is possible and cache keys don't collide
 * with other Redis users (e.g. BullMQ).
 */
export class RedisCache implements Cache {
    constructor(
        private readonly redis: Redis,
        private readonly prefix = "cache:",
    ) {}

    private key(key: string): string {
        return `${this.prefix}${key}`
    }

    async get<T>(key: string): Promise<T | null> {
        const raw = await this.redis.get(this.key(key))
        return raw === null ? null : (JSON.parse(raw) as T)
    }

    async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
        const raw = JSON.stringify(value)
        if (ttlSeconds && ttlSeconds > 0) {
            await this.redis.set(this.key(key), raw, "EX", ttlSeconds)
        } else {
            await this.redis.set(this.key(key), raw)
        }
    }

    async del(key: string): Promise<void> {
        await this.redis.del(this.key(key))
    }

    async wrap<T>(key: string, ttlSeconds: number, producer: () => Promise<T>): Promise<T> {
        const cached = await this.get<T>(key)
        if (cached !== null) return cached

        const fresh = await producer()
        await this.set(key, fresh, ttlSeconds)
        return fresh
    }
}
