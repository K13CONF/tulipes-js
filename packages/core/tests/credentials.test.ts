import { readFile } from "node:fs/promises";
import { expect, test, vi } from "vitest";
import { fixture } from "./fixture.js";

const valid = {
  JWT_ACCESS_SECRET: "fixture-access-key-long-enough",
  JWT_REFRESH_SECRET: "fixture-refresh-key-long-enough",
  AUTH_ADMIN_EMAIL: "fixture@example.test",
  AUTH_ADMIN_PASSWORD: "fixture-password-long-enough",
  JWT_ACCESS_TTL: "15m",
  JWT_REFRESH_TTL: "30d",
};

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

    const app = await fixture({
      "modules/probe/meta.variables.json": JSON.stringify({
        variables: Object.keys(valid).map((name) => ({
          name,
          type: "secret",
          required: true,
          description: name,
        })),
      }),
      "modules/probe/module.config.ts": await readFile(
        "example/modules/auth/module.config.ts",
        "utf8",
      ),
    });

    const error = await app
      .boot({ mode: "script", appEnv: "production" })
      .catch((error) => error);

    const staging = await app
      .boot({ mode: "script", appEnv: "staging" })
      .catch((error) => error);

    expect(staging).toBeInstanceOf(Error);
    expect(staging.message).toMatch(/unsafe|credential|distinct/);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/unsafe|credential|distinct/);

    for (const value of Object.values(values).filter((v) => v.length > 10))
      expect(error.message).not.toContain(value);
  },
);

test.each(["staging", "production", "development"] as const)(
  "configured credentials boot in %s",
  async (appEnv) => {
    for (const [key, value] of Object.entries(valid)) vi.stubEnv(key, value);

    const app = await fixture({
      "modules/probe/meta.variables.json": JSON.stringify({
        variables: Object.keys(valid).map((name) => ({
          name,
          type: "secret",
          required: true,
          description: name,
        })),
      }),
      "modules/probe/module.config.ts": await readFile(
        "example/modules/auth/module.config.ts",
        "utf8",
      ),
    });

    const handle = await app.boot({ mode: "script", appEnv });

    await handle.shutdown();
  },
);
