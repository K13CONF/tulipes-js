import type { ConfigCtx } from "@tulipes/core/boot";

export default function authConfig({ Environment }: ConfigCtx) {
  return {
    accessTtl: Environment.get("JWT_ACCESS_TTL"),
    refreshTtl: Environment.get("JWT_REFRESH_TTL"),
    /**
     * How stale a session's `last_seen_at` may get before a request pays for
     * the write. Policy, not a per-deployment value — every environment
     * wants the same answer, and one write per request is not it.
     */
    sessionTouchSeconds: 60,
  };
}
