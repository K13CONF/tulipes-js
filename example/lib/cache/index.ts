import { Redis } from "ioredis";
import type { Environment } from "@forgex/core/env";

import { MemoryCache } from "./memory-cache.js";
import { RedisCache } from "./redis-cache.js";
import type { Cache } from "./types.js";

export type { Cache } from "./types.js";
export { BaseCache } from "./types.js";
export { MemoryCache } from "./memory-cache.js";
export { RedisCache } from "./redis-cache.js";

let active: { cache: Cache; redis?: Redis } | undefined;

/**
 * The app's one cache, picked from the environment: redis when REDIS_URL is
 * declared, in-process memory otherwise (tests, minimal setups). Lazily
 * created, process-wide singleton.
 */
export function appCache(environment: Environment): Cache {
  if (active) return active.cache;

  if (environment.store.has("REDIS_URL")) {
    const redis = new Redis(String(environment.get("REDIS_URL")));
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
