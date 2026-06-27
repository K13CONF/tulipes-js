import { RedisCache, type Cache } from "@packages/cache/index.js"
import { getRedis } from "./redis.js"

/**
 * App-level cache wiring: binds the reusable `RedisCache` to the shared Redis
 * client. Swap `RedisCache` for `MemoryCache` here (or in tests) without
 * touching call sites — they depend on the `Cache` interface, not Redis.
 */
let instance: Cache | null = null

/** Initializes the cache from the shared Redis client. Call once during boot. */
export function initCache(): Cache {
    instance = new RedisCache(getRedis())
    return instance
}

/** The app cache. Throws if accessed before `initCache`. */
export function getCache(): Cache {
    if (!instance) throw new Error("Cache not initialized — call initCache() during boot first")
    return instance
}
