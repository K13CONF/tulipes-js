import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { Router, type RequestHandler } from "express";
import { Redis } from "ioredis";
import ipaddr from "ipaddr.js";
import { HttpError } from "@tulipes/core/http";
import type { Ctx } from "@tulipes/core/boot";

// One atomic, expiring counter per client and policy, shared by every backend.
// Rejected requests neither increase the counter nor extend its expiration.
const consume = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then
  redis.call('SET', KEYS[1], 1, 'PX', ARGV[2])
  return {1, tonumber(ARGV[2])}
end
if count >= tonumber(ARGV[1]) then return {0, ttl} end
redis.call('INCR', KEYS[1])
return {1, ttl}
`;

export interface RateLimitOptions {
  redisUrl: string;
  namespace: string;
  windowMs: number;
  authLimit: number;
  sessionLimit: number;
  configLimit: number;
}

/** The `rateLimits` setting, as `ctx.config.security.rateLimits`. */
export interface RateLimitSettings {
  namespace: string;
  windowMs: number;
  auth: number;
  session: number;
  config: number;
}

type RateLimits = ReturnType<typeof createRateLimits>;

/**
 * One limiter set per boot, built from the live settings on first use and
 * rebuilt by module.config's onChange when they change. The routes file
 * mounts a handler that always delegates to the current set, so a rebuild
 * never re-mounts anything; the previous set's client is closed once the
 * new one exists.
 */
const instances = new WeakMap<Ctx, { limits: RateLimits; settings: RateLimitSettings }>();

export function configuredRateLimits(ctx: Ctx): RateLimits {
  const current = instances.get(ctx);
  if (current) return current.limits;
  return rebuildRateLimits(ctx, settingsOf(ctx)).limits;
}

/** @internal module.config onChange and the first request. */
export function rebuildRateLimits(ctx: Ctx, settings: RateLimitSettings): { limits: RateLimits; settings: RateLimitSettings } {
  const previous = instances.get(ctx);
  if (previous && JSON.stringify(previous.settings) === JSON.stringify(settings)) return previous;
  const next = {
    settings: { ...settings },
    limits: createRateLimits({
      redisUrl: String(ctx.Environment.get("REDIS_URL")),
      namespace: settings.namespace + ":" + ctx.Environment.appEnv,
      windowMs: settings.windowMs,
      authLimit: settings.auth,
      sessionLimit: settings.session,
      configLimit: settings.config,
    }),
  };
  instances.set(ctx, next);
  previous?.limits.close();
  return next;
}

function settingsOf(ctx: Ctx): RateLimitSettings {
  const settings = (ctx.config.security as { rateLimits?: RateLimitSettings } | undefined)?.rateLimits;
  if (!settings) throw new Error("security settings are not loaded — the rate limiter is built after boot phase 6");
  return settings;
}

export function createRateLimits(options: RateLimitOptions) {
  for (const [name, value] of Object.entries({ windowMs: options.windowMs,
    auth: options.authLimit, session: options.sessionLimit, config: options.configLimit })) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
      throw new Error("rateLimits." + name + " must be a positive integer no greater than 2147483647");
    }
  }
  if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(options.namespace)) {
    throw new Error("rateLimits.namespace must use letters, digits, colon, underscore or hyphen (max 128 including app environment)");
  }
  const redis = new Redis(options.redisUrl, {
    lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0,
    connectTimeout: 1000, commandTimeout: 1000,
  });
  // Never log connection URLs or driver errors; HTTP failures use a stable code.
  redis.on("error", () => {});
  // Driver handshakes can involve several timed commands. Bound the initial
  // wait separately; reconnection may continue while requests fail closed.
  const ready = new Promise<void>(resolve => {
    const timer = setTimeout(resolve, 1000);
    timer.unref();
    void redis.connect().catch(() => {}).finally(() => { clearTimeout(timer); resolve(); });
  });
  const limit = (policy: string, maximum: number): RequestHandler => async (req, res, next) => {
    // Use only Express's resolved address. Invalid trusted-proxy input shares one
    // bucket, so arbitrary header strings cannot mint arbitrary client identities.
    let identity = "unknown";
    if (req.ip && isIP(req.ip)) {
      const address = ipaddr.process(req.ip);
      const bytes = address.toByteArray();
      if (address.kind() === "ipv6") bytes.fill(0, 7); // Aggregate IPv6 /56.
      identity = ipaddr.fromByteArray(bytes).toString();
    }
    const key = "tulipes:rate:" + options.namespace + ":" + policy + ":"
      + createHash("sha256").update(identity).digest("hex");
    let result: unknown;
    try {
      await ready;
      if (redis.status !== "ready") throw new Error("unavailable");
      result = await redis.eval(consume, 1, key, maximum, options.windowMs);
      if (!Array.isArray(result) || result.length !== 2 || ![0, 1].includes(result[0])
        || !Number.isSafeInteger(result[1]) || result[1] < 1) throw new Error("invalid counter");
    } catch {
      throw new HttpError(503, "rateLimitUnavailable", { code: "RATE_LIMIT_UNAVAILABLE",
        defaultMessage: "Request limits are unavailable; try again later" });
    }
    if (Array.isArray(result) && result[0] === 0) {
      res.setHeader("Retry-After", Math.max(1, Math.ceil(Number(result[1]) / 1000)));
      throw new HttpError(429, "tooManyRequests", { code: "TOO_MANY_REQUESTS",
        defaultMessage: "Too many requests; try again later" });
    }
    next();
  };
  const auth = Router();
  // The broad quota bounds all auth requests, including refresh, reads and misses.
  auth.use(limit("sessions", options.sessionLimit));
  auth.post(["/login", "/register", "/password"], limit("credentials", options.authLimit));
  return { auth, config: limit("config", options.configLimit), close: () => {
    redis.disconnect();
  } };
}

/** Security owns its connections, including partially initialized boot cleanup. */
export function closeRateLimits(ctx: Ctx): void {
  instances.get(ctx)?.limits.close();
  instances.delete(ctx);
}
