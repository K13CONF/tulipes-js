import type { Redis } from "ioredis";
import { BaseCache } from "./types.js";

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

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.#redis.get(this.#key(key));
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const raw = JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await this.#redis.set(this.#key(key), raw, "EX", ttlSeconds);
    } else {
      await this.#redis.set(this.#key(key), raw);
    }
  }

  async del(key: string): Promise<void> {
    await this.#redis.del(this.#key(key));
  }
}
