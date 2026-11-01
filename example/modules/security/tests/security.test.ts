import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { boot } from "@tulipes/core/boot";
import { useTestApp } from "@tulipes/testing";

import { testEnv, testSettings } from "../../../tests/support.ts";

const rootDir = fileURLToPath(new URL("../../../", import.meta.url));
const app = useTestApp({ rootDir, env: testEnv(), settings: testSettings() }, { beforeAll, afterAll });


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

test("CORS permits explicit Bearer headers without enabling cookie credentials", async () => {
  const origin = "https://console.example.test";
  const endpoint = app.base + "/api/v1/auth/me";

  const preflight = await fetch(endpoint, {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "GET",
      "access-control-request-headers": "authorization",
    },
  });

  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);

  expect(preflight.headers.get("access-control-allow-headers")).toBe(
    "authorization",
  );

  expect(preflight.headers.has("access-control-allow-credentials")).toBe(false);

  const initial = await account();

  const allowed = await fetch(endpoint, {
    headers: { origin, authorization: "Bearer " + initial.access_token },
  });

  expect(allowed.status).toBe(200);
  expect(allowed.headers.get("access-control-allow-origin")).toBe(origin);
  expect(allowed.headers.has("access-control-allow-credentials")).toBe(false);

  // Node does not enforce CORS. This proves CORS is not server authorization:
  // a valid Bearer token still works, while the origin gets no read permission.
  const unlisted = await fetch(endpoint, {
    headers: {
      origin: "https://unlisted.example.test",
      authorization: "Bearer " + initial.access_token,
    },
  });

  expect(unlisted.status).toBe(200);
  expect(unlisted.headers.has("access-control-allow-origin")).toBe(false);
});

test("configured proxy trust supplies the same client IP to sessions and durable audits", async () => {
  const user = await sysadmin();
  const headers = { "X-Forwarded-For": "203.0.113.200, 198.51.100.19" };

  const login = await fetch(app.base + "/api/v1/auth/login", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });

  expect(login.status).toBe(200);

  const pair = tokens.parse(await login.json()).data;
  const identity = await get("/api/v1/auth/me", pair.access_token);

  expect(await identity.json()).toMatchObject({
    data: { session: { ip: "198.51.100.19" } },
  });

  const changed = await fetch(app.base + "/api/v1/config/hello", {
    method: "PATCH",
    headers: { ...headers, "content-type": "application/json", authorization: "Bearer " + pair.access_token },
    body: JSON.stringify({ values: { greeting: "Hello" }, version: app.handle.ctx.settings.describe("hello").stored.version }),
  });

  expect(changed.status).toBe(200);

  expect(
    await app.handle.ctx
      .models!.get("ConfigAudit")
      .findOne({ actor: user.userId })
      .lean(),
  ).toMatchObject({ ip: "198.51.100.19", module: "hello", keys: ["greeting"] });
});

test.each(["auth/login", "config"])(
  "%s limits attempts before parsing or authentication",
  async (path) => {
    const responses = await Promise.all(
      Array.from({ length: 201 }, (_, index) =>
        fetch(app.base + "/api/v1/" + path, {
          method: path.startsWith("auth") ? "POST" : "GET",
          headers: {
            "X-Forwarded-For":
              "203.0.113." + ((index % 250) + 1) + ", 198.51.100.88",
            "content-type": "application/json",
          },
          ...(path.startsWith("auth") ? { body: "{" } : {}),
        }),
      ),
    );

    expect(
      responses.filter((response) => response.status === 429),
    ).toHaveLength(1);

    const blocked = responses.find((response) => response.status === 429)!;

    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);

    expect(await blocked.json()).toMatchObject({
      success: false,
      errors: [{ code: "TOO_MANY_REQUESTS" }],
    });

    expect((await fetch(app.base + "/api/v1/hello")).status).toBe(200);
  },
);

test("trusted proxies refuse an IPv4-mapped IPv6 range, which proxy-addr matches against every IPv4 peer", async () => {
  const { trustedProxies } = await import("../helpers/proxy.ts");
  expect(trustedProxies("10.0.0.0/8, 2001:db8::1")).toEqual(["10.0.0.0/8", "2001:db8::1"]);
  for (const mapped of ["::ffff:0.0.0.0/96", "::FFFF:10.0.0.1", "0:0:0:0:0:ffff:a00:1/120"]) {
    expect(() => trustedProxies(mapped), mapped).toThrow(/IPv4-mapped/);
  }
});
