import cors, { type CorsOptions } from "cors"
import helmet from "helmet"
import { rateLimit, type Options as RateLimitOptions, type RateLimitRequestHandler } from "express-rate-limit"
import { RedisStore } from "rate-limit-redis"
import type { RequestHandler } from "express"
import config from "@config/app.config.js"
import { logger } from "@config/logger.js"
import { TooManyRequestsError } from "@packages/acl/errors.js"
import { getRedis, isRedisConnected } from "./redis.js"

/**
 * Edge security middleware — security headers, CORS, and rate limiting — built
 * from `config.app.lib.security`. Wired (in order) by `lib/express.ts`.
 */

const { cors: corsCfg, rateLimit: rlCfg } = config.app.lib.security

// ── Security headers (helmet) ───────────────────────────────────────────────
// API defaults: HSTS on (only bites over HTTPS), framework version hidden.
// CSP is disabled — this serves JSON, not HTML, so a page CSP adds no value;
// turn it on if you ever render HTML. CORP is set to same-site for APIs.
export const helmetMiddleware: RequestHandler = helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
})

// ── CORS ────────────────────────────────────────────────────────────────────
// Requests with no Origin (curl, server-to-server) pass through; a browser
// request from a listed origin gets CORS headers; any other origin simply gets
// no CORS headers (the browser blocks it) — we never throw a 500. "*" in the
// allowlist allows any origin and is intended for development only.
const allowAnyOrigin = corsCfg.origins.includes("*")
const corsOptions: CorsOptions = {
    origin(origin, callback) {
        if (!origin || allowAnyOrigin || corsCfg.origins.includes(origin)) {
            return callback(null, true)
        }
        return callback(null, false)
    },
    credentials: corsCfg.credentials,
}
export const corsMiddleware: RequestHandler = cors(corsOptions)

// ── Rate limiting ───────────────────────────────────────────────────────────
/**
 * Redis-backed store so the limit is shared across PM2 cluster instances. Falls
 * back to express-rate-limit's in-memory store (per-process) when Redis isn't
 * connected — degraded but never a hard failure.
 */
function makeStore(prefix: string): RedisStore | undefined {
    if (!isRedisConnected()) {
        logger.warn(
            `Rate limiter "${prefix}" using in-memory store (Redis not connected) — limits are per-process`,
        )
        return undefined
    }
    const redis = getRedis()
    return new RedisStore({
        prefix,
        sendCommand: (...args: string[]) =>
            redis.call(...(args as [string, ...string[]])) as Promise<number | string>,
    })
}

function buildLimiter(opts: { windowMs: number; limit: number; prefix: string }): RateLimitRequestHandler {
    const options: Partial<RateLimitOptions> = {
        windowMs: opts.windowMs,
        limit: opts.limit,
        standardHeaders: true, // RateLimit-* headers
        legacyHeaders: false, // no X-RateLimit-* headers
        // Route rejections through the central error handler so they use the
        // unified envelope and per-request i18n (not express-rate-limit's text).
        handler: (_req, _res, next) => next(new TooManyRequestsError()),
    }
    const store = makeStore(opts.prefix)
    if (store) options.store = store
    return rateLimit(options)
}

/** Global per-IP limiter — applied to every request. */
export const rateLimiter = buildLimiter({
    windowMs: rlCfg.windowMs,
    limit: rlCfg.max,
    prefix: "rl:global:",
})

/**
 * Stricter limiter for authentication routes (login, password reset, …). Not
 * wired globally — attach it per-route once those endpoints exist, e.g.
 * `require("auth.login").post("/login", authRateLimiter, handler)`.
 */
export const authRateLimiter = buildLimiter({
    windowMs: rlCfg.windowMs,
    limit: rlCfg.authMax,
    prefix: "rl:auth:",
})

// ── Input sanitization ──────────────────────────────────────────────────────
/** Recursively removes keys that start with `$` or contain `.` (Mongo operators / paths). */
function scrub(value: unknown): void {
    if (!value || typeof value !== "object") return
    if (Array.isArray(value)) {
        value.forEach(scrub)
        return
    }
    for (const key of Object.keys(value)) {
        if (key.startsWith("$") || key.includes(".")) {
            delete (value as Record<string, unknown>)[key]
            continue
        }
        scrub((value as Record<string, unknown>)[key])
    }
}

/**
 * Strips Mongo operator keys from request inputs — defense-in-depth behind zod
 * validation (the primary guard). Mutates `body`/`params` in place; `req.query`
 * is read-only in Express 5, so it's scrubbed best-effort.
 */
export const mongoSanitize: RequestHandler = (req, _res, next) => {
    scrub(req.body)
    scrub(req.params)
    try {
        scrub(req.query)
    } catch {
        // Express 5 may expose req.query as a read-only getter — rely on zod there.
    }
    next()
}
