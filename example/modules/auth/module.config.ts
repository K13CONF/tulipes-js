import type { Ctx } from "@tulipes/core/boot";

export default function authConfig({ Environment }: Ctx) {
  return {
    accessTtl: Environment.get("JWT_ACCESS_TTL"),
    refreshTtl: Environment.get("JWT_REFRESH_TTL"),
    /**
     * How stale a session's `lastSeenAt` may get before a request pays for
     * the write. Policy, not a per-deployment value — every environment
     * wants the same answer, and one write per request is not it.
     */
    sessionTouchSeconds: 60,
  };
}
