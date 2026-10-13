import { readFile } from "node:fs/promises";
import { expect, test, vi } from "vitest";
import { fixture } from "./fixture.ts";

/**
 * The reference app's credentials guard, booted as its own module so the
 * values land where the guard reads them: `config.auth.*`.
 */
const valid = {
  JWT_ACCESS_SECRET: "fixture-access-key-long-enough",
  JWT_REFRESH_SECRET: "fixture-refresh-key-long-enough",
  AUTH_ADMIN_EMAIL: "fixture@example.test",
  AUTH_ADMIN_PASSWORD: "fixture-password-long-enough",
};

/** The declaration the reference auth module ships, keyed the same way. */
const authManifest = JSON.stringify({
  name: "@test/auth",
  type: "module",
  tulipes: {
    env: {
      jwtAccessSecret: { key: "JWT_ACCESS_SECRET", type: "secret", required: true, description: "access key" },
      jwtRefreshSecret: { key: "JWT_REFRESH_SECRET", type: "secret", required: true, description: "refresh key" },
      adminEmail: { key: "AUTH_ADMIN_EMAIL", type: "string", required: true, description: "seeded admin" },
      adminPassword: { key: "AUTH_ADMIN_PASSWORD", type: "secret", required: true, description: "seeded admin password" },
    },
  },
});

const authApp = async () => fixture({
  "modules/auth/package.json": authManifest,
  "modules/auth/bootstrap/credentials.bootstrap.ts": await readFile("example/modules/auth/bootstrap/credentials.bootstrap.ts", "utf8"),
});

test.each([
  { JWT_ACCESS_SECRET: "dev-only-access-secret-change-me" },
  { JWT_REFRESH_SECRET: "dev-only-refresh-secret-change-me" },
  { AUTH_ADMIN_PASSWORD: "dev-admin-password" },
  { AUTH_ADMIN_EMAIL: "admin@example.com" },
  { JWT_ACCESS_SECRET: "   " },
  { JWT_REFRESH_SECRET: valid.JWT_ACCESS_SECRET },
])(
  "refuses unsafe production auth configuration without leaking credentials: %j",
  async (override) => {
    const values = { ...valid, ...override };
    for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
    const app = await authApp();

    const production = await app.boot({ mode: "script", appEnv: "production" }).catch((error) => error);
    const staging = await app.boot({ mode: "script", appEnv: "staging" }).catch((error) => error);

    for (const error of [production, staging]) {
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toMatch(/unsafe|credential|distinct/);
      // The message names the variable to fix, never the value it holds.
      for (const value of Object.values(values).filter((v) => v.length > 10)) expect(error.message).not.toContain(value);
    }
  },
);

test.each(["staging", "production", "development"] as const)("configured credentials boot in %s", async (appEnv) => {
  for (const [key, value] of Object.entries(valid)) vi.stubEnv(key, value);
  const app = await authApp();

  const handle = await app.boot({ mode: "script", appEnv });

  await handle.shutdown();
});
