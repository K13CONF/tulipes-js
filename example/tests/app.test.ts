import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { boot, type BootHandle } from "@tulipes/core/boot";

let handle: BootHandle;
let base: string;
beforeAll(async () => {
  vi.stubEnv("PORT", "0");
  if (!process.env.TEST_MONGO_URI || !process.env.TEST_REDIS_URL) {
    throw new Error("Tests require dedicated TEST_MONGO_URI and TEST_REDIS_URL services");
  }
  vi.stubEnv("MONGO_URI", process.env.TEST_MONGO_URI);
  vi.stubEnv("REDIS_URL", process.env.TEST_REDIS_URL);
  vi.stubEnv("JWT_ACCESS_SECRET", randomBytes(32).toString("hex"));
  vi.stubEnv("JWT_REFRESH_SECRET", randomBytes(32).toString("hex"));
  vi.stubEnv("AUTH_ADMIN_EMAIL", "test-admin@example.test");
  vi.stubEnv("AUTH_ADMIN_PASSWORD", randomBytes(32).toString("hex"));
  vi.stubEnv("LOG_FILE", "false");
  vi.stubEnv("LOG_CONSOLE", "false");
  handle = await boot({ rootDir: fileURLToPath(new URL("../", import.meta.url)), appEnv: "test", handleSignals: false });
  const address = handle.server?.address();
  if (!address || typeof address === "string") throw new Error("No HTTP listener");
  base = "http://127.0.0.1:" + address.port;
}, 15_000);
afterAll(async () => { await handle?.shutdown(); vi.unstubAllEnvs(); });

test("hello responds through the declared public endpoint", async () => {
  const response = await fetch(base + "/api/v1/hello");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ success: true, errors: [] });
});

test("unknown endpoints return the error envelope", async () => {
  const response = await fetch(base + "/not-a-route");
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ success: false, data: null });
});

const tokens = z.object({ data: z.object({ access_token: z.string(), refresh_token: z.string() }) });

async function post(path: string, body: unknown, token?: string) {
  return fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) });
}

test("one concurrent refresh wins and logout revokes both token halves", async () => {
  const registered = await post("/api/v1/auth/register", { email: randomBytes(12).toString("hex") + "@example.test", password: randomBytes(24).toString("hex") });
  expect(registered.status).toBe(201);
  const initial = tokens.parse(await registered.json()).data;
  const attempts = await Promise.all([post("/api/v1/auth/refresh", { refresh_token: initial.refresh_token }), post("/api/v1/auth/refresh", { refresh_token: initial.refresh_token })]);
  expect(attempts.map(response => response.status).sort()).toEqual([200, 401]);
  const rotated = tokens.parse(await attempts.find(response => response.status === 200)!.json()).data;
  expect((await post("/api/v1/auth/logout", {}, rotated.access_token)).status).toBe(200);
  for (const token of [initial.access_token, rotated.access_token]) {
    expect((await fetch(base + "/api/v1/auth/me", { headers: { authorization: "Bearer " + token } })).status).toBe(401);
  }
  expect((await post("/api/v1/auth/refresh", { refresh_token: rotated.refresh_token })).status).toBe(401);
});
