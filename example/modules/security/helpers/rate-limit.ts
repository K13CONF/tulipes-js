import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { Router, type RequestHandler } from "express";
import { Redis } from "ioredis";
import ipaddr from "ipaddr.js";
import { HttpError } from "@tulipes/core/http";
import type { Environment } from "@tulipes/core/env";

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
  settingsLimit: number;
}

const instances = new WeakMap<Environment, ReturnType<typeof createRateLimits>>();

export function configuredRateLimits(environment: Environment) {
  const existing = instances.get(environment);
  if (existing) return existing;
  const limits = createRateLimits({
    redisUrl: String(environment.get("REDIS_URL")),
    namespace: String(environment.get("RATE_LIMIT_NAMESPACE")) + ":" + environment.appEnv,
    windowMs: Number(environment.get("RATE_LIMIT_WINDOW_MS")),
    authLimit: Number(environment.get("AUTH_RATE_LIMIT")),
    sessionLimit: Number(environment.get("AUTH_SESSION_RATE_LIMIT")),
    settingsLimit: Number(environment.get("SETTINGS_RATE_LIMIT")),
  });
  instances.set(environment, limits);
  return limits;
}

export function createRateLimits(options: RateLimitOptions) {
  for (const [name, value] of Object.entries({ RATE_LIMIT_WINDOW_MS: options.windowMs,
    AUTH_RATE_LIMIT: options.authLimit, AUTH_SESSION_RATE_LIMIT: options.sessionLimit,
    SETTINGS_RATE_LIMIT: options.settingsLimit })) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
      throw new Error(name + " must be a positive integer no greater than 2147483647");
    }
  }
  if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(options.namespace)) {
    throw new Error("RATE_LIMIT_NAMESPACE must use letters, digits, colon, underscore or hyphen (max 128 including app environment)");
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
  return { auth, settings: limit("settings", options.settingsLimit), close: () => {
    redis.disconnect();
  } };
}

/** Security owns its connections, including partially initialized boot cleanup. */
export function closeRateLimits(environment: Environment): void {
  instances.get(environment)?.close();
  instances.delete(environment);
}
