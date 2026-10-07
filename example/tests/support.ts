import { randomBytes } from "node:crypto";

/**
 * What every module test boots the app with. The services are dedicated:
 * the suite writes users, sessions and settings. The variables are the
 * eleven the app declares; everything else the request pipeline needs is a
 * setting, written after the boot the way an operator writes it.
 */
export function testEnv(): Record<string, string> {
  if (!process.env.TEST_MONGO_URI || !process.env.TEST_REDIS_URL) {
    throw new Error("Tests require dedicated TEST_MONGO_URI and TEST_REDIS_URL services");
  }
  return {
    MONGO_URI: process.env.TEST_MONGO_URI,
    REDIS_URL: process.env.TEST_REDIS_URL,
    JWT_ACCESS_SECRET: randomBytes(32).toString("hex"),
    JWT_REFRESH_SECRET: randomBytes(32).toString("hex"),
    AUTH_ADMIN_EMAIL: "test-admin@example.test",
    AUTH_ADMIN_PASSWORD: randomBytes(32).toString("hex"),
    LOG_LEVEL: "fatal",
    LOG_FILE: "false",
    LOG_CONSOLE: "false",
  };
}

export function testSettings(): Record<string, Record<string, unknown>> {
  return {
    security: {
      trustProxyCidrs: "127.0.0.1/32,::1/128",
      corsOrigins: "https://console.example.test",
      corsCredentials: false,
      rateLimits: { namespace: "test-" + randomBytes(12).toString("hex"), windowMs: 60_000, auth: 200, session: 1000, config: 200 },
    },
    hello: { greeting: "Hello" },
  };
}
