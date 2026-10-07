import type { RuntimeCtx } from "@tulipes/core/boot";

/**
 * Outside development the seeded credentials and signing keys must not be
 * the scaffold's placeholders, and the two keys must differ so leaking one
 * cannot mint the other. Sorted before seed-admin so the admin is never
 * seeded with a refused password.
 */
export default function credentials({ Environment }: RuntimeCtx): void {
  if (Environment.appEnv !== "production" && Environment.appEnv !== "staging") return;
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
