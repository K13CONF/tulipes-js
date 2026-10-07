import { defineConfig } from "@tulipes/core/config";
import { z } from "zod/v4";

/**
 * Token policy is a setting: every deployment wants to tune it, none of it
 * is secret. The signing keys and the seeded admin credentials stay in the
 * environment, where secrets belong, and `bootstrap/credentials.bootstrap.ts`
 * refuses development values outside development.
 */
export default defineConfig({
  schema: z.object({
    accessTtl: z.string().min(1).default("15m")
      .describe("Access token lifetime, as an ms/jsonwebtoken duration. Keep it short: a revoked user keeps their role until it expires"),
    refreshTtl: z.string().min(1).default("30d")
      .describe("Refresh token lifetime; also the TTL on its database record"),
    /**
     * How stale a session's `last_seen_at` may get before a request pays for
     * the write. One write per request is not an option; one per minute is.
     */
    sessionTouchSeconds: z.number().int().positive().default(60)
      .describe("Seconds between two writes of a session's last_seen_at"),
    /**
     * A resolved token is kept in the app cache this long, bounded by
     * accessTtl; 0 disables the cache. Revocations delete the entry, so
     * the bound only matters while Redis is unreachable at that moment.
     */
    cacheTtlSeconds: z.number().int().min(0).max(3600).default(60)
      .describe("Seconds a resolved session stays in the cache (0 disables it); never longer than accessTtl"),
  }),
});
