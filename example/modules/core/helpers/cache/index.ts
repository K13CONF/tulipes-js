import { Redis } from "ioredis";
import type { Environment } from "@tulipes/core/env";

import { MemoryCache } from "./memory-cache.ts";
import { RedisCache } from "./redis-cache.ts";
import type { Cache } from "./types.ts";

export type { Cache } from "./types.ts";
export { BaseCache } from "./types.ts";
export { MemoryCache } from "./memory-cache.ts";
export { RedisCache } from "./redis-cache.ts";

let active: { cache: Cache; redis?: Redis } | undefined;

/**
 * The app's one cache, picked from the environment: redis when REDIS_URL is
 * declared, in-process memory otherwise (tests, minimal setups). Lazily
 * created, process-wide singleton.
 */
export function appCache(environment: Environment): Cache {
  if (active) return active.cache;

  if (environment.store.has("REDIS_URL")) {
    // Fail a command fast instead of queueing it and retrying for seconds: the
    // cache is consulted on every request, so a redis outage must cost a miss,
    // not a stalled request. RedisCache turns the rejection into that miss.
    const redis = new Redis(String(environment.get("REDIS_URL")), {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    // ioredis makes an unhandled "error" event an uncaught exception; the cache
    // reports what it actually affects, when it affects it.
    redis.on("error", () => {});
    active = { cache: new RedisCache(redis), redis };
  } else {
    active = { cache: new MemoryCache() };
  }
  return active.cache;
}

/** Call from a module's onShutdown — the redis driver holds a connection. */
export async function closeCache(): Promise<void> {
  await active?.redis?.quit();
  active = undefined;
}
