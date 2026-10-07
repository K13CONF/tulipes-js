import { defineConfig } from "@tulipes/core/config";
import { z } from "zod/v4";

import { corsOptions } from "./helpers/hardening.ts";
import { rebuildRateLimits } from "./helpers/rate-limit.ts";
import { trustedProxies } from "./helpers/proxy.ts";

/**
 * Everything the request pipeline is configured with. None of it is a
 * secret and none of it is needed before the settings store answers, so
 * none of it is an environment variable: an operator changes it through
 * the console and every replica rebuilds its middleware from `onChange`.
 * The schema refuses a value the middleware could not be built from, so a
 * bad write never lands in the store.
 */
export default defineConfig({
  schema: z.object({
    passwordRounds: z.number().int().min(4).max(31).default(12)
      .describe("bcrypt cost factor for new password hashes; existing hashes are upgraded on login"),
    bodyLimit: z.string().regex(/^\d+(\.\d+)?\s*(b|kb|mb|gb)?$/i).default("1mb")
      .describe("Largest JSON request body express parses, e.g. \"1mb\"; nginx client_max_body_size must be at least this"),
    trustProxyCidrs: z.string().default("")
      .refine((raw) => { try { trustedProxies(raw); return true; } catch { return false; } },
        "Empty, or a comma-separated list of IP addresses/CIDRs with nonzero prefix lengths")
      .describe("Comma-separated trusted proxy addresses or CIDRs; empty ignores forwarded headers. Configure only actual proxy peers"),
    corsOrigins: z.string().default("")
      .describe("Comma-separated browser origins allowed to read API responses; \"*\" allows any, empty allows none (same-origin only)"),
    corsCredentials: z.boolean().default(false)
      .describe("Emit Access-Control-Allow-Credentials for browser credential mode; does not enable cookie authentication or CSRF protection (cannot be combined with corsOrigins \"*\")"),
    hstsMaxAge: z.number().int().min(0).default(15_552_000)
      .describe("Strict-Transport-Security max-age in seconds; 0 disables the header (browsers only honour it over HTTPS)"),
    rateLimits: z.object({
      namespace: z.string().regex(/^[a-zA-Z0-9:_-]{1,100}$/).default("tulipes")
        .describe("Stable identifier shared by replicas; use a different value for unrelated apps on the same Redis database"),
      windowMs: z.number().int().min(1).max(2_147_483_647).default(60_000)
        .describe("Fixed request window in milliseconds"),
      auth: z.number().int().min(1).max(2_147_483_647).default(20)
        .describe("Combined login, register and password POST attempts per client per window"),
      session: z.number().int().min(1).max(2_147_483_647).default(120)
        .describe("All auth requests per client per window, including refresh and credential attempts"),
      config: z.number().int().min(1).max(2_147_483_647).default(60)
        .describe("All console (config and settings) requests per client per window"),
    }).default({ namespace: "tulipes", windowMs: 60_000, auth: 20, session: 120, config: 60 })
      .describe("Shared request quotas, counted in Redis so replicas agree"),
  }).refine((values) => { try { corsOptions(values); return true; } catch { return false; } }, {
    path: ["corsCredentials"],
    message: "corsOrigins \"*\" cannot be combined with corsCredentials — list the origins explicitly",
  }),

  /**
   * Helmet, CORS and the body parser read the live values on every
   * request; the rate limiter holds a Redis client and the proxy policy is
   * an app setting, so those two are rebuilt here.
   */
  onChange(next, ctx) {
    ctx.app?.set("trust proxy", trustedProxies(next.trustProxyCidrs));
    rebuildRateLimits(ctx, next.rateLimits);
  },
});
