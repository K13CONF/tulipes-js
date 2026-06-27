import { Redis, type RedisOptions } from "ioredis"
import { logger } from "@config/logger.js"

/** Redis connection settings (sourced from `config.app.lib.redis`). */
export interface RedisConfig {
    host: string
    port: number
    password?: string | undefined
    db: number
}

/** The shared client — used by the cache. BullMQ builds its own from `RedisConfig`. */
let client: Redis | null = null

/** Builds ioredis options from the app config; `extra` lets callers override. */
function buildOptions(cfg: RedisConfig, extra?: RedisOptions): RedisOptions {
    return {
        host: cfg.host,
        port: cfg.port,
        db: cfg.db,
        ...(cfg.password ? { password: cfg.password } : {}),
        ...extra,
    }
}

/**
 * Connects the shared Redis client (used by the cache). Resolves once ready;
 * rejects on the first failed attempt so startup can fail fast.
 */
export async function connectRedis(cfg: RedisConfig): Promise<Redis> {
    const redis = new Redis(buildOptions(cfg, { lazyConnect: true }))
    redis.on("error", (err) => logger.error({ err }, "Redis connection error"))
    redis.on("ready", () => logger.info("Redis connected"))
    redis.on("close", () => logger.warn("Redis disconnected"))

    await redis.connect()
    client = redis
    return redis
}

/** The shared Redis client. Throws if accessed before `connectRedis`. */
export function getRedis(): Redis {
    if (!client) throw new Error("Redis not connected — call connectRedis() during boot first")
    return client
}

/** Closes the shared Redis client (e.g. on graceful shutdown). */
export async function disconnectRedis(): Promise<void> {
    if (client) {
        await client.quit()
        client = null
    }
}

/** Whether the shared Redis client is currently ready. */
export function isRedisConnected(): boolean {
    return client?.status === "ready"
}
