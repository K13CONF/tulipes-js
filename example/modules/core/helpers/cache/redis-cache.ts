import type { Redis } from "ioredis";
import { BaseCache } from "./types.ts";

/**
 * Redis-backed cache. Values are JSON-serialized; keys are namespaced by
 * `prefix` so cache keys never collide with other Redis users in the same
 * db (BullMQ especially) and can be cleared without a FLUSHDB.
 */
export class RedisCache extends BaseCache {
  readonly #redis: Redis;
  readonly #prefix: string;

  constructor(redis: Redis, prefix = "cache:") {
    super();
    this.#redis = redis;
    this.#prefix = prefix;
  }

  #key(key: string): string {
    return `${this.#prefix}${key}`;
  }

  /**
   * A cache is best effort, and this one sits in global middleware: if a redis
   * outage threw from here, every endpoint would answer 500 — an outage of the
   * whole API caused by an optional dependency. Every operation therefore
   * degrades to "no cache" and says so at most once every 30 seconds.
   */
  #reportedAt = 0;

  #degraded(operation: string, error: unknown): void {
    const now = Date.now();
    if (now - this.#reportedAt < 30_000) return;
    this.#reportedAt = now;
    console.error(`[cache] redis ${operation} failed; serving without cache: ${(error as Error).message}`);
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.#redis.get(this.#key(key));
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch (error) {
      this.#degraded("get", error);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const raw = JSON.stringify(value);
    try {
      if (ttlSeconds && ttlSeconds > 0) {
        await this.#redis.set(this.#key(key), raw, "EX", ttlSeconds);
      } else {
        await this.#redis.set(this.#key(key), raw);
      }
    } catch (error) {
      this.#degraded("set", error);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.#redis.del(this.#key(key));
    } catch (error) {
      this.#degraded("del", error);
    }
  }
}
