import type { ConfigCtx } from "@tulipes/core/boot";

export default function authConfig({ Environment }: ConfigCtx) {
  if (Environment.appEnv === "production" || Environment.appEnv === "staging") {
    const invalid: string[] = [];
    const defaults = [
      ["JWT_ACCESS_SECRET", "dev-only-access-secret-change-me"],
      ["JWT_REFRESH_SECRET", "dev-only-refresh-secret-change-me"],
      ["AUTH_ADMIN_PASSWORD", "dev-admin-password"],
      ["AUTH_ADMIN_EMAIL", "admin@example.com"],
    ] as const;
    for (const [name, developmentValue] of defaults) {
      const value = String(Environment.get(name)).trim();
      if (!value || value === developmentValue) invalid.push(name);
    }
    if (Environment.get("JWT_ACCESS_SECRET") === Environment.get("JWT_REFRESH_SECRET")) {
      invalid.push("JWT_ACCESS_SECRET / JWT_REFRESH_SECRET (use distinct keys)");
    }
    if (invalid.length) throw new Error("Unsafe production credentials: configure " + invalid.join(", "));
  }
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
