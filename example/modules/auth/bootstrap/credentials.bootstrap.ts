import type { RuntimeCtx } from "@tulipes/core/boot";

/**
 * Outside development the seeded credentials and signing keys must not be
 * the scaffold's placeholders, and the two keys must differ so leaking one
 * cannot mint the other. Sorted before seed-admin so the admin is never
 * seeded with a refused password.
 *
 * The values are this module's environment values, `config.auth.*`; the
 * message names the variables an operator sets, not the config names.
 */
const PLACEHOLDERS = [
  ["jwtAccessSecret", "JWT_ACCESS_SECRET", "dev-only-access-secret-change-me"],
  ["jwtRefreshSecret", "JWT_REFRESH_SECRET", "dev-only-refresh-secret-change-me"],
  ["adminPassword", "AUTH_ADMIN_PASSWORD", "dev-admin-password"],
  ["adminEmail", "AUTH_ADMIN_EMAIL", "admin@example.com"],
] as const;

export default function credentials({ appEnv, config }: RuntimeCtx): void {
  if (appEnv !== "production" && appEnv !== "staging") return;

  const auth = config.auth!;
  const invalid: string[] = [];

  for (const [name, variable, developmentValue] of PLACEHOLDERS) {
    const value = auth[name].trim();
    if (!value || value === developmentValue) invalid.push(variable);
  }
  if (auth.jwtAccessSecret === auth.jwtRefreshSecret) {
    invalid.push("JWT_ACCESS_SECRET / JWT_REFRESH_SECRET (use distinct keys)");
  }

  if (invalid.length) throw new Error("Unsafe production credentials: configure " + invalid.join(", "));
}
