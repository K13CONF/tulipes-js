import { Redis } from "ioredis";
import type { Ctx } from "@tulipes/core/boot";

import { MemoryCache } from "./memory-cache.ts";
import { RedisCache } from "./redis-cache.ts";
import type { Cache } from "./types.ts";

export type { Cache } from "./types.ts";
export { BaseCache } from "./types.ts";
export { MemoryCache } from "./memory-cache.ts";
export { RedisCache } from "./redis-cache.ts";

let active: { cache: Cache; redis?: Redis } | undefined;

/**
 * The app's one cache, picked from the core module's environment values:
 * redis when `config.core.redisUrl` is set, in-process memory otherwise
 * (tests, minimal setups). Lazily created, process-wide singleton; the
 * cache bootstrap opens it at boot with `openCache`, so the first request
 * does not race the connection.
 */
export function appCache({ config }: Pick<Ctx, "config">): Cache {
  if (active) return active.cache;

  const redisUrl = config.core?.redisUrl;
  if (redisUrl) {
    // Fail a command fast instead of queueing it and retrying for seconds: the
    // cache is consulted on every request, so a redis outage must cost a miss,
    // not a stalled request. RedisCache turns the rejection into that miss.
    const redis = new Redis(redisUrl, {
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

/**
 * Open the cache at boot and wait, bounded, until redis is ready. With the
 * offline queue off, commands sent while the client is still connecting are
 * rejected, so the first requests would miss, fail to store, and log a
 * false outage. Never throws: a redis that does not come up in time leaves
 * the app as an outage would, without the cache and saying so.
 */
export async function openCache(ctx: Pick<Ctx, "config">, timeoutMs = 5000): Promise<void> {
  appCache(ctx);
  const redis = active?.redis;
  if (!redis || redis.status === "ready") return;

  await new Promise<void>((done) => {
    const finish = () => {
      clearTimeout(timer);
      redis.off("ready", finish);
      redis.off("end", finish);
      done();
    };
    const timer = setTimeout(finish, timeoutMs);
    redis.once("ready", finish);
    redis.once("end", finish);
  });
}

/**
 * The cache bootstrap's cleanup: the redis driver holds a connection. QUIT
 * is the orderly close, but with the offline queue off it is refused on a
 * client that is not ready — a process stopping while the first connection
 * is still being made, or during an outage — so that client is dropped.
 */
export async function closeCache(): Promise<void> {
  const redis = active?.redis;
  active = undefined;
  if (!redis) return;
  if (redis.status === "ready") {
    try {
      await redis.quit();
      return;
    } catch {
      // fall through: the connection went away between the check and QUIT
    }
  }
  redis.disconnect();
}
