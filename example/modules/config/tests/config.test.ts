import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { boot } from "@tulipes/core/boot";
import { useTestApp } from "@tulipes/testing";

import { testEnv, testSettings } from "../../../tests/support.ts";

const rootDir = fileURLToPath(new URL("../../../", import.meta.url));
const env = testEnv();
const app = useTestApp({ rootDir, env, settings: testSettings() }, { beforeAll, afterAll });


const tokens = z.object({
  data: z.object({ access_token: z.string(), refresh_token: z.string() }),
});

async function post(path: string, body: unknown, token?: string) {
  return fetch(app.base + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function account() {
  const credentials = {
    email: randomBytes(12).toString("hex") + "@example.test",
    password: randomBytes(24).toString("hex"),
  };

  const response = await post("/api/v1/auth/register", credentials);

  expect(response.status).toBe(201);

  const body = await response.json();

  const { user } = z
    .object({ data: z.object({ user: z.object({ id: z.string() }) }) })
    .parse(body).data;

  return { ...tokens.parse(body).data, ...credentials, userId: user.id };
}

async function get(path: string, token: string) {
  return fetch(app.base + path, { headers: { authorization: "Bearer " + token } });
}

async function sysadmin() {
  const user = await account();

  await app.handle.ctx
    .models!.get("User")
    .updateOne({ _id: user.userId }, { role: "sysadmin" });

  return user;
}

async function patch(path: string, body: unknown, token: string) {
  return fetch(app.base + path, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + token,
    },
    body: JSON.stringify(body),
  });
}

test("the console describes every module without a secret's value and only administrators read it", async () => {
  const ordinary = await account();
  const admin = await account();
  await app.handle.ctx.models!.get("User").updateOne({ _id: admin.userId }, { role: "admin" });

  expect((await get("/api/v1/config", ordinary.access_token)).status).toBe(403);

  const response = await get("/api/v1/config", admin.access_token);
  expect(response.status).toBe(200);
  const { data } = (await response.json()) as { data: { store: { ready: boolean }; roles: Record<string, unknown>[]; modules: Record<string, unknown>[] } };
  expect(data.store.ready).toBe(true);
  expect(data.modules.map((module) => module.name)).toEqual(app.handle.ctx.modules.map((module) => module.name));
  expect(data.roles).toContainEqual({
    name: "admin",
    description: "Runs the back office",
    defined_by: "auth",
    extras: { level: 2 },
    grants: ["agent:*", "agents:*", "auth:*", "config:bo:describe", "config:bo:read", "hello:*", "users:*"],
  });

  const auth = data.modules.find((module) => module.name === "auth") as { variables: Record<string, unknown>[]; settings: { values: Record<string, unknown>; version: number }; routes: Record<string, unknown>[] };
  const secret = auth.variables.find((variable) => variable.name === "jwtAccessSecret")!;
  expect(secret).toMatchObject({ key: "JWT_ACCESS_SECRET", type: "secret", source: "process.env", is_secret: true, is_set: true, value: null, default: null });
  expect(JSON.stringify(data)).not.toContain(env.JWT_ACCESS_SECRET);
  expect(auth.settings.values).toMatchObject({ accessTtl: "15m" });
  expect(auth.routes).toContainEqual(expect.objectContaining({ id: "auth:web:login", method: "POST", roles: expect.arrayContaining(["guest"]) }));

  // The administrator may read; writing is the deployment's job.
  expect((await patch("/api/v1/config/hello", { values: { greeting: "Nope" } }, admin.access_token)).status).toBe(403);
});

test("a settings write is validated by the module's schema, refused on a stale version, audited without values and applied at once", async () => {
  const user = await sysadmin();
  const described = (await (await get("/api/v1/config/hello", user.access_token)).json()) as { data: { settings: { version: number } } };
  const before = described.data.settings.version;

  const invalid = await patch("/api/v1/config/hello", { values: { greeting: "" } }, user.access_token);
  expect(invalid.status).toBe(422);
  expect(await invalid.json()).toMatchObject({ errors: [{ field: "greeting" }] });

  const stale = await patch("/api/v1/config/hello", { values: { greeting: "Howdy" }, version: before + 7 }, user.access_token);
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ errors: [{ code: "STALE_VERSION" }] });

  const written = await patch("/api/v1/config/hello", { values: { greeting: "Howdy" }, version: before }, user.access_token);
  expect(written.status).toBe(200);
  expect(await written.json()).toMatchObject({ data: { module: "hello", values: { greeting: "Howdy" }, version: before + 1, requires_restart: [] } });

  // Live in this process, through the same object every handler reads.
  expect(app.handle.ctx.config.hello).toEqual({ greeting: "Howdy" });
  const greeted = (await (await fetch(app.base + "/api/v1/hello")).json()) as { data: { message: string } };
  expect(greeted.data.message).toMatch(/^Howdy/);

  const audit = await app.handle.ctx.models!.get("ConfigAudit").find({ actor: user.userId }).sort({ recorded_at: -1 }).lean();
  expect(audit[0]).toMatchObject({ action: "settings.change_requested", module: "hello", keys: ["greeting"], version: before, actor_role: "sysadmin" });
  expect(JSON.stringify(audit)).not.toContain("Howdy");

  expect((await patch("/api/v1/config/nope", { values: {} }, user.access_token)).status).toBe(404);

  await app.handle.ctx.settings.set("hello", { greeting: "Hello" }, { id: "tests" });
});
