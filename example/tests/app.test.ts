import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { boot, type BootHandle } from "@tulipes/core/boot";
import { extract, toOpenApi, toPostman } from "@tulipes/spec";

let handle: BootHandle;
let base: string;

beforeAll(async () => {
  vi.stubEnv("PORT", "0");

  if (!process.env.TEST_MONGO_URI || !process.env.TEST_REDIS_URL) {
    throw new Error(
      "Tests require dedicated TEST_MONGO_URI and TEST_REDIS_URL services",
    );
  }

  vi.stubEnv("MONGO_URI", process.env.TEST_MONGO_URI);
  vi.stubEnv("REDIS_URL", process.env.TEST_REDIS_URL);
  vi.stubEnv("JWT_ACCESS_SECRET", randomBytes(32).toString("hex"));
  vi.stubEnv("JWT_REFRESH_SECRET", randomBytes(32).toString("hex"));
  vi.stubEnv("AUTH_ADMIN_EMAIL", "test-admin@example.test");
  vi.stubEnv("AUTH_ADMIN_PASSWORD", randomBytes(32).toString("hex"));
  vi.stubEnv("LOG_LEVEL", "fatal");
  vi.stubEnv("LOG_FILE", "false");
  vi.stubEnv("LOG_CONSOLE", "false");

  handle = await boot({
    rootDir: fileURLToPath(new URL("../", import.meta.url)),
    appEnv: "test",
    handleSignals: false,
  });

  // The request pipeline is configured from settings, not variables: the
  // values a test run needs are written to the store the way an operator
  // writes them, and every replica (the second boot below included) reads
  // them from there.
  await handle.ctx.settings.set("security", {
    trustProxyCidrs: "127.0.0.1/32,::1/128",
    corsOrigins: "https://console.example.test",
    corsCredentials: false,
    rateLimits: { namespace: "test-" + randomBytes(12).toString("hex"), windowMs: 60_000, auth: 200, session: 1000, config: 200 },
  }, { id: "tests" });
  await handle.ctx.settings.set("hello", { greeting: "Hello" }, { id: "tests" });

  const address = handle.server?.address();

  if (!address || typeof address === "string")
    throw new Error("No HTTP listener");

  base = "http://127.0.0.1:" + address.port;
}, 15_000);

afterAll(async () => {
  await handle?.shutdown();

  vi.unstubAllEnvs();
});

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

test("an inspection boot describes the same routes and schemas as the running app", async () => {
  const inspection = await boot({
    rootDir: fileURLToPath(new URL("../", import.meta.url)),
    mode: "backend",
    inspect: true,
    handleSignals: false,
  });

  try {
    const inspected = { ...extract(inspection.ctx), app: { name: "parity" } };
    const runtime = { ...extract(handle.ctx), app: { name: "parity" } };

    expect(await toOpenApi(inspected)).toEqual(await toOpenApi(runtime));
    expect(await toPostman(inspected)).toEqual(await toPostman(runtime));
  } finally {
    await inspection.shutdown();
  }
});

const tokens = z.object({
  data: z.object({ access_token: z.string(), refresh_token: z.string() }),
});

async function post(path: string, body: unknown, token?: string) {
  return fetch(base + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify(body),
  });
}

test("concurrent refresh has one winner but reuse invalidates its family", async () => {
  const initial = await account();

  const attempts = await Promise.all([
    post("/api/v1/auth/refresh", { refresh_token: initial.refresh_token }),
    post("/api/v1/auth/refresh", { refresh_token: initial.refresh_token }),
  ]);

  expect(attempts.map((response) => response.status).sort()).toEqual([
    200, 401,
  ]);

  const winner = attempts.find((response) => response.status === 200)!;
  const rotated = tokens.parse(await winner.json()).data;

  // The server cannot tell a duplicate client request from a stolen token.
  await assertRejected(initial);

  await assertRejected(rotated);
});

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
  return fetch(base + path, { headers: { authorization: "Bearer " + token } });
}

async function assertRejected(pair: {
  access_token: string;
  refresh_token: string;
}) {
  expect((await get("/api/v1/auth/me", pair.access_token)).status).toBe(401);

  expect(
    (await post("/api/v1/auth/refresh", { refresh_token: pair.refresh_token }))
      .status,
  ).toBe(401);
}

test("refresh reuse revokes its whole device family while other devices survive", async () => {
  const initial = await account();

  const login = await post("/api/v1/auth/login", {
    email: initial.email,
    password: initial.password,
  });

  const other = tokens.parse(await login.json()).data;

  // Reuse an ancestor after two rotations, not just the immediately prior token.
  const first = await post("/api/v1/auth/refresh", {
    refresh_token: initial.refresh_token,
  });

  const firstPair = tokens.parse(await first.json()).data;

  const second = await post("/api/v1/auth/refresh", {
    refresh_token: firstPair.refresh_token,
  });

  const latest = tokens.parse(await second.json()).data;

  const replay = await post("/api/v1/auth/refresh", {
    refresh_token: initial.refresh_token,
  });

  expect(replay.status).toBe(401);

  for (const pair of [initial, firstPair, latest]) {
    await assertRejected(pair);
  }

  expect((await get("/api/v1/auth/me", other.access_token)).status).toBe(200);

  const devices = await get("/api/v1/auth/sessions", other.access_token);

  expect(
    z.object({ data: z.array(z.unknown()) }).parse(await devices.json()).data,
  ).toHaveLength(1);

  expect(
    (
      await post("/api/v1/auth/refresh", {
        refresh_token: other.refresh_token,
      })
    ).status,
  ).toBe(200);
});

test("a delayed successful rotation cannot resurrect a family revoked by reuse", async () => {
  const initial = await account();
  const collection = handle.ctx.models!.get("Session").collection;
  const update = collection.findOneAndUpdate.bind(collection);
  const committed = barrier();
  const release = barrier();

  // Hold the winner after its database write, before the HTTP response returns.
  const spy = vi
    .spyOn(collection, "findOneAndUpdate")
    .mockImplementationOnce(async (...args) => {
      const result = await update(...args);

      committed.resolve();

      await release.promise;

      return result;
    });

  const pending = post("/api/v1/auth/refresh", {
    refresh_token: initial.refresh_token,
  });

  try {
    await Promise.race([
      committed.promise,
      pending.then(() => {
        throw new Error("Rotation did not reach the write barrier");
      }),
    ]);

    const replay = await post("/api/v1/auth/refresh", {
      refresh_token: initial.refresh_token,
    });

    expect(replay.status).toBe(401);

    release.resolve();

    const winner = await pending;

    expect(winner.status).toBe(200);

    await assertRejected(tokens.parse(await winner.json()).data);

    await assertRejected(initial);
  } finally {
    release.resolve();

    await pending;

    spy.mockRestore();
  }
});

test("unacknowledged refresh writes return a sanitized failure without claiming revocation", async () => {
  const initial = await account();

  const first = await post("/api/v1/auth/refresh", {
    refresh_token: initial.refresh_token,
  });

  const latest = tokens.parse(await first.json()).data;
  const canary = "private refresh database error";

  const spy = vi
    .spyOn(handle.ctx.models!.get("Session").collection, "findOneAndUpdate")
    .mockRejectedValueOnce(new Error(canary));

  try {
    const failed = await post("/api/v1/auth/refresh", {
      refresh_token: initial.refresh_token,
    });

    expect(failed.status).toBe(503);

    expect(await failed.json()).toMatchObject({
      errors: [{ code: "REFRESH_UNAVAILABLE" }],
    });
  } finally {
    spy.mockRestore();
  }

  // The failed write did not revoke the family. A later replay must still do so.
  expect((await get("/api/v1/auth/me", latest.access_token)).status).toBe(200);

  expect(
    (
      await post("/api/v1/auth/refresh", {
        refresh_token: initial.refresh_token,
      })
    ).status,
  ).toBe(401);

  await assertRejected(latest);
});

test("invalid refresh credentials cannot revoke a live family", async () => {
  const { default: jwt } = await import("jsonwebtoken");
  const initial = await account();
  const other = await account();
  const original = jwt.decode(initial.refresh_token) as Record<string, unknown>;
  const key = String(handle.ctx.Environment.get("JWT_REFRESH_SECRET"));

  const sign = (changes: Record<string, unknown>) =>
    jwt.sign({ ...original, ...changes }, key);

  const missingJti = { ...original };

  delete missingJti.jti;

  const invalid = [
    jwt.sign(original, "different-signing-key"),
    sign({ typ: "access" }),
    sign({ exp: Math.floor(Date.now() / 1000) - 1 }),
    jwt.sign(missingJti, key),
    sign({ jti: { $ne: null } }),
    sign({ sid: { $ne: null } }),
    sign({ sub: { $ne: null } }),
  ];

  // Signed malformed claims still cannot become filters or replay evidence.
  for (const token of invalid) {
    const response = await post("/api/v1/auth/refresh", {
      refresh_token: token,
    });

    expect(response.status).toBe(401);
  }

  // Valid shape and signature alone do not establish ownership of another sid.
  const wrongOwner = await post("/api/v1/auth/refresh", {
    refresh_token: sign({ sub: other.userId }),
  });

  expect(wrongOwner.status).toBe(401);
  expect((await get("/api/v1/auth/me", initial.access_token)).status).toBe(200);
  expect((await get("/api/v1/auth/me", other.access_token)).status).toBe(200);

  expect(
    (
      await post("/api/v1/auth/refresh", {
        refresh_token: initial.refresh_token,
      })
    ).status,
  ).toBe(200);
});

test("an expired ancestor is rejected without revoking its still-live descendants", async () => {
  const initial = await account();
  const { default: jwt } = await import("jsonwebtoken");
  const ancestor = jwt.decode(initial.refresh_token) as { exp: number };
  let latest!: { access_token: string; refresh_token: string };

  // Move only the app clock so the ancestor expires while the rotated pair does not.
  vi.useFakeTimers({ toFake: ["Date"] });

  try {
    vi.setSystemTime(new Date((ancestor.exp - 60) * 1000));

    const rotated = await post("/api/v1/auth/refresh", {
      refresh_token: initial.refresh_token,
    });

    expect(rotated.status).toBe(200);

    latest = tokens.parse(await rotated.json()).data;

    vi.setSystemTime(new Date(ancestor.exp * 1000));

    const expired = await post("/api/v1/auth/refresh", {
      refresh_token: initial.refresh_token,
    });

    expect(expired.status).toBe(401);

    expect((await get("/api/v1/auth/me", latest.access_token)).status).toBe(
      200,
    );
  } finally {
    vi.useRealTimers();
  }
});

test("a lost acknowledgment after replay revocation never restores the family", async () => {
  const initial = await account();

  const first = await post("/api/v1/auth/refresh", {
    refresh_token: initial.refresh_token,
  });

  const latest = tokens.parse(await first.json()).data;
  const collection = handle.ctx.models!.get("Session").collection;
  const update = collection.findOneAndUpdate.bind(collection);

  // Simulate MongoDB committing the update before the reply is lost in transit.
  const spy = vi
    .spyOn(collection, "findOneAndUpdate")
    .mockImplementationOnce(async (...args) => {
      await update(...args);

      throw new Error("private lost acknowledgment");
    });

  try {
    const failed = await post("/api/v1/auth/refresh", {
      refresh_token: initial.refresh_token,
    });

    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        writeConcern: { w: "majority", j: true, wtimeout: 5000 },
      }),
    );

    expect(failed.status).toBe(503);

    expect(await failed.json()).toMatchObject({
      errors: [{ code: "REFRESH_UNAVAILABLE" }],
    });
  } finally {
    spy.mockRestore();
  }

  await assertRejected(latest);

  await assertRejected(initial);
});

test("browser credentials use headers and JSON without issuing cookies", async () => {
  const credentials = {
    email: randomBytes(12).toString("hex") + "@example.test",
    password: randomBytes(24).toString("hex"),
  };

  const registered = await post("/api/v1/auth/register", credentials);

  expect(registered.status).toBe(201);
  expect(registered.headers.has("set-cookie")).toBe(false);

  const login = await post("/api/v1/auth/login", credentials);

  expect(login.status).toBe(200);
  expect(login.headers.has("set-cookie")).toBe(false);

  const initial = tokens.parse(await login.json()).data;
  const cookie = "access_token=" + initial.access_token;

  // A valid token in an ambient cookie or URL must not establish identity.
  const cookieOnly = await fetch(base + "/api/v1/auth/me", {
    headers: { cookie },
  });

  const queryOnly = await fetch(
    base + "/api/v1/auth/me?access_token=" + initial.access_token,
  );

  expect(cookieOnly.status).toBe(401);
  expect(queryOnly.status).toBe(401);
  expect((await get("/api/v1/auth/me", initial.access_token)).status).toBe(200);

  // Cookie-only logout must also leave the real session usable.
  const logoutWithCookie = await fetch(base + "/api/v1/auth/logout", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: "{}",
  });

  expect(logoutWithCookie.status).toBe(401);

  const refreshed = await post("/api/v1/auth/refresh", {
    refresh_token: initial.refresh_token,
  });

  expect(refreshed.status).toBe(200);
  expect(refreshed.headers.has("set-cookie")).toBe(false);

  const rotated = tokens.parse(await refreshed.json()).data;
  const logout = await post("/api/v1/auth/logout", {}, rotated.access_token);

  expect(logout.status).toBe(200);
  expect(logout.headers.has("set-cookie")).toBe(false);

  await assertRejected(rotated);

  await assertRejected(initial);
});

test("refresh ignores cookie and URL credentials and does not parse simple form bodies", async () => {
  const initial = await account();
  const endpoint = base + "/api/v1/auth/refresh";
  const refresh = initial.refresh_token;

  const attempts = [
    await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "refresh_token=" + refresh,
      },
      body: "{}",
    }),
    await fetch(endpoint + "?refresh_token=" + refresh, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
    await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ refresh_token: refresh }),
    }),
    await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ refresh_token: refresh }),
    }),
  ];

  const form = new FormData();

  form.set("refresh_token", refresh);

  attempts.push(await fetch(endpoint, { method: "POST", body: form }));

  for (const response of attempts) {
    expect(response.status).toBe(422);
    expect(response.headers.has("set-cookie")).toBe(false);
  }

  // Rejections must not consume the credential that was carried incorrectly.
  const accepted = await post("/api/v1/auth/refresh", {
    refresh_token: refresh,
  });

  expect(accepted.status).toBe(200);
});

test("CORS permits explicit Bearer headers without enabling cookie credentials", async () => {
  const origin = "https://console.example.test";
  const endpoint = base + "/api/v1/auth/me";

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

test("session expiry rejects access and refresh before TTL cleanup and hides the device", async () => {
  const initial = await account();
  const Session = handle.ctx.models!.get("Session");

  // Keep the row in Mongo's future; advance only the app clock to the exact
  // boundary so asynchronous TTL deletion cannot make this regression pass.
  const expires = new Date(Date.now() + 120_000);

  await Session.updateOne({ user: initial.userId }, { expires_at: expires });

  const login = await post("/api/v1/auth/login", {
    email: initial.email,
    password: initial.password,
  });

  expect(login.status).toBe(200);

  const other = tokens.parse(await login.json()).data;

  vi.useFakeTimers({ toFake: ["Date"] });

  vi.setSystemTime(expires);

  try {
    const sessions = await get("/api/v1/auth/sessions", other.access_token);

    expect(sessions.status).toBe(200);

    expect
      .soft(
        z.object({ data: z.array(z.unknown()) }).parse(await sessions.json())
          .data,
      )
      .toHaveLength(1);

    // Check both independently so a failed access assertion cannot hide refresh.
    expect
      .soft((await get("/api/v1/auth/me", initial.access_token)).status)
      .toBe(401);

    expect
      .soft(
        (
          await post("/api/v1/auth/refresh", {
            refresh_token: initial.refresh_token,
          })
        ).status,
      )
      .toBe(401);

    expect(await Session.countDocuments({ user: initial.userId })).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});

test("a session reassigned to another account cannot authenticate or refresh its old tokens", async () => {
  const initial = await account();
  const other = await account();

  await handle.ctx
    .models!.get("Session")
    .updateOne({ user: initial.userId }, { user: other.userId });

  expect
    .soft((await get("/api/v1/auth/me", initial.access_token)).status)
    .toBe(401);

  expect
    .soft(
      (
        await post("/api/v1/auth/refresh", {
          refresh_token: initial.refresh_token,
        })
      ).status,
    )
    .toBe(401);

  expect((await get("/api/v1/auth/me", other.access_token)).status).toBe(200);
});

test("password change in the same JWT second revokes both devices and keeps the replacement usable", async () => {
  // Freeze only Date, leaving HTTP, Mongo and bcrypt timers operational.
  vi.useFakeTimers({ toFake: ["Date"] });

  vi.setSystemTime(new Date(Math.floor(Date.now() / 1000) * 1000 + 100));

  try {
    const initial = await account();

    const login = await post("/api/v1/auth/login", {
      email: initial.email,
      password: initial.password,
    });

    expect(login.status).toBe(200);

    const other = tokens.parse(await login.json()).data;

    vi.setSystemTime(new Date(Date.now() + 500));

    const password = randomBytes(24).toString("hex");

    const changed = await post(
      "/api/v1/auth/password",
      { password },
      initial.access_token,
    );

    expect(changed.status).toBe(200);

    const replacement = tokens.parse(await changed.json()).data;

    await assertRejected(initial);

    await assertRejected(other);

    expect(
      (await get("/api/v1/auth/me", replacement.access_token)).status,
    ).toBe(200);

    expect(
      (
        await post("/api/v1/auth/refresh", {
          refresh_token: replacement.refresh_token,
        })
      ).status,
    ).toBe(200);

    expect(
      (
        await post("/api/v1/auth/login", {
          email: initial.email,
          password: initial.password,
        })
      ).status,
    ).toBe(401);

    expect(
      (await post("/api/v1/auth/login", { email: initial.email, password }))
        .status,
    ).toBe(200);
  } finally {
    vi.useRealTimers();
  }
});

test("refresh racing with device revocation cannot leave a usable token pair", async () => {
  const initial = await account();

  const login = await post("/api/v1/auth/login", {
    email: initial.email,
    password: initial.password,
  });

  expect(login.status).toBe(200);

  const other = tokens.parse(await login.json()).data;
  const identity = await get("/api/v1/auth/me", other.access_token);

  const { session } = z
    .object({ data: z.object({ session: z.object({ sid: z.string() }) }) })
    .parse(await identity.json()).data;

  const [revoked, refreshed] = await Promise.all([
    fetch(base + "/api/v1/auth/sessions/" + session.sid, {
      method: "DELETE",
      headers: { authorization: "Bearer " + initial.access_token },
    }),
    post("/api/v1/auth/refresh", { refresh_token: other.refresh_token }),
  ]);

  expect(revoked.status).toBe(200);
  expect([200, 401]).toContain(refreshed.status);

  await assertRejected(other);

  if (refreshed.status === 200)
    await assertRejected(tokens.parse(await refreshed.json()).data);

  expect((await get("/api/v1/auth/me", initial.access_token)).status).toBe(200);
});

function barrier() {
  let resolve!: () => void;

  const promise = new Promise<void>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

test.each(["login", "password", "cleanup", "credential-write"])(
  "a paused %s cannot create a valid session after a later password change",
  async (operation) => {
    const initial = await account();
    const firstPassword = randomBytes(24).toString("hex");
    const latestPassword = randomBytes(24).toString("hex");
    const collection = handle.ctx.models!.get("Session").collection;
    const insert = collection.insertOne.bind(collection);
    const remove = collection.deleteMany.bind(collection);
    const credentials = handle.ctx.models!.get("Credential").collection;
    const replace = credentials.findOneAndUpdate.bind(credentials);
    const entered = barrier();
    const release = barrier();

    const spy =
      operation === "credential-write"
        ? vi
            .spyOn(credentials, "findOneAndUpdate")
            .mockImplementationOnce(async (...args) => {
              entered.resolve();

              await release.promise;

              return replace(...args);
            })
        : operation === "cleanup"
          ? vi
              .spyOn(collection, "deleteMany")
              .mockImplementationOnce(async (...args) => {
                entered.resolve();

                await release.promise;

                return remove(...args);
              })
          : vi
              .spyOn(collection, "insertOne")
              .mockImplementationOnce(async (...args) => {
                entered.resolve();

                await release.promise;

                return insert(...args);
              });

    const pending =
      operation === "login"
        ? post("/api/v1/auth/login", {
            email: initial.email,
            password: initial.password,
          })
        : post(
            "/api/v1/auth/password",
            { password: firstPassword },
            initial.access_token,
          );

    try {
      // The real request has verified/written its password and reached session
      // insertion or cleanup. Complete a later change before releasing that write.
      await Promise.race([
        entered.promise,
        pending.then(() => {
          throw new Error("Request never reached the session barrier");
        }),
      ]);

      let access = initial.access_token;

      if (operation === "password" || operation === "cleanup") {
        const login = await post("/api/v1/auth/login", {
          email: initial.email,
          password: firstPassword,
        });

        expect(login.status).toBe(200);

        access = tokens.parse(await login.json()).data.access_token;
      }

      const changed = await post(
        "/api/v1/auth/password",
        { password: latestPassword },
        access,
      );

      expect(changed.status).toBe(200);

      const latest = tokens.parse(await changed.json()).data;

      release.resolve();

      const stale = await pending;

      expect.soft(stale.status).toBe(401);

      if (stale.status === 200)
        await assertRejected(tokens.parse(await stale.json()).data);

      expect((await get("/api/v1/auth/me", latest.access_token)).status).toBe(
        200,
      );

      expect(
        (
          await post("/api/v1/auth/login", {
            email: initial.email,
            password: latestPassword,
          })
        ).status,
      ).toBe(200);
    } finally {
      release.resolve();

      await pending;

      spy.mockRestore();
    }
  },
);

test("failed session cleanup after password replacement cannot preserve old sessions", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });

  vi.setSystemTime(new Date(Math.floor(Date.now() / 1000) * 1000 + 100));

  try {
    const initial = await account();
    const password = randomBytes(24).toString("hex");

    const spy = vi
      .spyOn(handle.ctx.models!.get("Session").collection, "deleteMany")
      .mockRejectedValueOnce(new Error("injected cleanup failure"));

    try {
      const changed = await post(
        "/api/v1/auth/password",
        { password },
        initial.access_token,
      );

      expect(changed.status).toBe(500);
    } finally {
      spy.mockRestore();
    }

    expect(
      await handle.ctx
        .models!.get("Session")
        .countDocuments({ user: initial.userId }),
    ).toBe(1);

    expect
      .soft((await get("/api/v1/auth/me", initial.access_token)).status)
      .toBe(401);

    expect
      .soft(
        (
          await post("/api/v1/auth/refresh", {
            refresh_token: initial.refresh_token,
          })
        ).status,
      )
      .toBe(401);

    expect(
      (
        await post("/api/v1/auth/login", {
          email: initial.email,
          password: initial.password,
        })
      ).status,
    ).toBe(401);

    const login = await post("/api/v1/auth/login", {
      email: initial.email,
      password,
    });

    expect(login.status).toBe(200);

    const current = tokens.parse(await login.json()).data;
    const sessions = await get("/api/v1/auth/sessions", current.access_token);

    expect(
      z.object({ data: z.array(z.unknown()) }).parse(await sessions.json())
        .data,
    ).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

test("a failed credential write preserves the old password and session", async () => {
  const initial = await account();
  const password = randomBytes(24).toString("hex");

  const spy = vi
    .spyOn(handle.ctx.models!.get("Credential").collection, "findOneAndUpdate")
    .mockRejectedValueOnce(new Error("injected credential failure"));

  try {
    expect(
      (await post("/api/v1/auth/password", { password }, initial.access_token))
        .status,
    ).toBe(500);
  } finally {
    spy.mockRestore();
  }

  expect((await get("/api/v1/auth/me", initial.access_token)).status).toBe(200);

  expect(
    (
      await post("/api/v1/auth/refresh", {
        refresh_token: initial.refresh_token,
      })
    ).status,
  ).toBe(200);

  expect(
    (
      await post("/api/v1/auth/login", {
        email: initial.email,
        password: initial.password,
      })
    ).status,
  ).toBe(200);

  expect(
    (await post("/api/v1/auth/login", { email: initial.email, password }))
      .status,
  ).toBe(401);
});

test("legacy credentials upgrade on login while sessions without a version require reauthentication", async () => {
  const initial = await account();
  const Credential = handle.ctx.models!.get("Credential");
  const Session = handle.ctx.models!.get("Session");

  // Use collection writes to simulate persisted data from the previous starter.
  const credential = await Credential.findOne({
    user: initial.userId,
  }).orFail();

  await Credential.collection.updateOne(
    { _id: credential._id },
    { $unset: { version: "" } },
  );

  await Session.collection.updateMany(
    { user: credential.get("user") },
    { $unset: { credential_version: "" } },
  );

  await assertRejected(initial);

  const login = await post("/api/v1/auth/login", {
    email: initial.email,
    password: initial.password,
  });

  expect(login.status).toBe(200);

  const current = tokens.parse(await login.json()).data;

  expect((await get("/api/v1/auth/me", current.access_token)).status).toBe(200);

  await assertRejected(initial);
});

test("a legacy login cannot upgrade credentials replaced while its verification was in flight", async () => {
  const initial = await account();
  const Credential = handle.ctx.models!.get("Credential");
  const row = await Credential.findOne({ user: initial.userId }).orFail();

  await Credential.collection.updateOne(
    { _id: row._id },
    { $unset: { version: "" } },
  );

  const update = Credential.collection.updateOne.bind(Credential.collection);
  const entered = barrier();
  const release = barrier();

  const spy = vi
    .spyOn(Credential.collection, "updateOne")
    .mockImplementationOnce(async (...args) => {
      entered.resolve();

      await release.promise;

      return update(...args);
    });

  const pending = post("/api/v1/auth/login", {
    email: initial.email,
    password: initial.password,
  });

  try {
    await Promise.race([
      entered.promise,
      pending.then(() => {
        throw new Error("Login never reached the credential barrier");
      }),
    ]);

    const password = randomBytes(24).toString("hex");

    const { setPassword } = await import(
      "../modules/auth/helpers/passwords.ts"
    );

    await setPassword(handle.ctx, initial.userId, password);

    release.resolve();

    expect((await pending).status).toBe(401);

    expect(
      (await post("/api/v1/auth/login", { email: initial.email, password }))
        .status,
    ).toBe(200);
  } finally {
    release.resolve();

    await pending;

    spy.mockRestore();
  }
});

async function sysadmin() {
  const user = await account();

  await handle.ctx
    .models!.get("User")
    .updateOne({ _id: user.userId }, { role: "sysadmin" });

  return user;
}

test("configured proxy trust supplies the same client IP to sessions and durable audits", async () => {
  const user = await sysadmin();
  const headers = { "X-Forwarded-For": "203.0.113.200, 198.51.100.19" };

  const login = await fetch(base + "/api/v1/auth/login", {
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

  const changed = await fetch(base + "/api/v1/config/hello", {
    method: "PATCH",
    headers: { ...headers, "content-type": "application/json", authorization: "Bearer " + pair.access_token },
    body: JSON.stringify({ values: { greeting: "Hello" } }),
  });

  expect(changed.status).toBe(200);

  expect(
    await handle.ctx
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
        fetch(base + "/api/v1/" + path, {
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

    expect((await fetch(base + "/api/v1/hello")).status).toBe(200);
  },
);

async function logFiles(run: (dir: string) => Promise<void>) {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "tulipes-log-http-"));
  const env = handle.ctx.Environment;

  const previous = {
    file: env.get("LOG_FILE"),
    dir: env.get("LOG_DIR"),
    name: env.get("LOG_BASENAME"),
  };

  env.store.set("LOG_FILE", true);

  env.store.set("LOG_DIR", dir);

  env.store.set("LOG_BASENAME", "app");

  try {
    await run(dir);
  } finally {
    env.store.set("LOG_FILE", previous.file);

    env.store.set("LOG_DIR", previous.dir);

    env.store.set("LOG_BASENAME", previous.name);

    await rm(dir, { recursive: true, force: true });
  }
}

test("log streaming enforces sysadmin access and never follows linked log targets", async () => {
  const ordinary = await account();
  const user = await sysadmin();

  await logFiles(async (dir) => {
    const { writeFile, symlink } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const canary = randomBytes(24).toString("hex");

    await writeFile(join(dir, "private"), canary);

    await symlink(join(dir, "private"), join(dir, "app-backend.log"));

    expect(
      (await get("/api/v1/settings/logs/stream", ordinary.access_token)).status,
    ).toBe(403);

    const response = await get(
      "/api/v1/settings/logs/stream",
      user.access_token,
    );

    expect(response.status).toBe(409);
    expect((await response.text()).includes(canary)).toBe(false);
  });
});

test("log stream slots are capped per account and released on HTTP cancellation", async () => {
  const user = await sysadmin();

  await logFiles(async (dir) => {
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    await writeFile(
      join(dir, "app-backend.2026-09-10.1.log"),
      JSON.stringify({ level: 30, msg: "retained line" }) + "\n",
    );

    const first = await get("/api/v1/settings/logs/stream", user.access_token);
    const second = await get("/api/v1/settings/logs/stream", user.access_token);

    try {
      expect(first.status).toBe(200);
      expect(first.headers.get("content-type")).toContain("text/event-stream");

      const blocked = await get(
        "/api/v1/settings/logs/stream",
        user.access_token,
      );

      expect(blocked.status).toBe(429);

      expect(await blocked.json()).toMatchObject({
        errors: [{ code: "TOO_MANY_LOG_STREAMS" }],
      });
    } finally {
      await first.body?.cancel();

      await second.body?.cancel();
    }

    let reopened: Response | undefined;

    await vi.waitFor(async () => {
      const response = await get(
        "/api/v1/settings/logs/stream",
        user.access_token,
      );

      if (response.status === 200) reopened = response;

      expect(response.status).toBe(200);
    });

    try {
      const reader = reopened!.body!.getReader();
      let received = "";

      try {
        while (!received.includes("retained line")) {
          const part = await reader.read();

          if (part.done) break;

          received += new TextDecoder().decode(part.value);
        }

        expect(received).toContain("event: ready");
        expect(received).toContain("retained line");
      } finally {
        await reader.cancel();
      }
    } finally {
      if (!reopened!.body!.locked) await reopened!.body!.cancel();
    }
  });
});

test.each([
  "role removal",
  "user deletion",
  "session revocation",
  "session expiry",
  "access revocation",
  "logout",
  "password replacement",
  "refresh reuse",
])("an open log stream closes after %s", async (change) => {
  const user = await sysadmin();

  const { verify, endSession, revokeAccess } = await import(
    "../modules/auth/helpers/tokens.ts"
  );

  const claims = verify(handle.ctx, user.access_token, "access")!;

  await logFiles(async (dir) => {
    const response = await get(
      "/api/v1/settings/logs/stream?tail=0",
      user.access_token,
    );

    expect(response.status).toBe(200);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let body = "";

    try {
      // Observe actual SSE delivery before changing the authority behind it.
      while (!body.includes("event: ready")) {
        const part = await reader.read();

        expect(part.done).toBe(false);

        body += decoder.decode(part.value);
      }

      if (change === "role removal") {
        await handle.ctx
          .models!.get("User")
          .updateOne({ _id: user.userId }, { role: "admin" });
      } else if (change === "user deletion") {
        await handle.ctx.models!.get("User").deleteOne({ _id: user.userId });
      } else if (change === "session revocation") {
        await endSession(handle.ctx, claims.sid);
      } else if (change === "session expiry") {
        await handle.ctx
          .models!.get("Session")
          .updateOne({ sid: claims.sid }, { expires_at: new Date(0) });
      } else if (change === "access revocation") {
        await revokeAccess(handle.ctx, claims);
      } else if (change === "logout") {
        expect(
          (await post("/api/v1/auth/logout", {}, user.access_token)).status,
        ).toBe(200);
      } else if (change === "password replacement") {
        const { setPassword } = await import(
          "../modules/auth/helpers/passwords.ts"
        );

        await setPassword(
          handle.ctx,
          user.userId,
          randomBytes(24).toString("hex"),
        );
      } else {
        expect(
          (
            await post("/api/v1/auth/refresh", {
              refresh_token: user.refresh_token,
            })
          ).status,
        ).toBe(200);

        expect(
          (
            await post("/api/v1/auth/refresh", {
              refresh_token: user.refresh_token,
            })
          ).status,
        ).toBe(401);
      }

      const started = performance.now();
      let timeout: ReturnType<typeof setTimeout> | undefined;

      try {
        await Promise.race([
          (async () => {
            for (;;) {
              const part = await reader.read();

              if (part.done) break;

              body += decoder.decode(part.value);
            }
          })(),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Revoked stream stayed open")),
              3000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }

      // Two-second authorization lease plus scheduling tolerance on this runner.
      expect(performance.now() - started).toBeLessThan(3000);

      const { writeFile } = await import("node:fs/promises");
      const { join } = await import("node:path");

      await writeFile(join(dir, "app-backend.log"), "after revocation\n");

      expect((await reader.read()).done).toBe(true);
      expect(body).not.toContain("after revocation");

      // A different administrator can still use the controller after closure.
      const other = await sysadmin();

      const replacement = await get(
        "/api/v1/settings/logs/stream?tail=0",
        other.access_token,
      );

      expect(replacement.status).toBe(200);

      await replacement.body?.cancel();
    } finally {
      await reader.cancel();
    }
  });
});

test("shutdown drains settings streams and a later boot owns fresh stream admission", async () => {
  const user = await sysadmin();

  await logFiles(async (dir) => {
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    await writeFile(
      join(dir, "app-backend.log"),
      JSON.stringify({ msg: "before drain" }) + "\n",
    );

    const active = await get("/api/v1/settings/logs/stream", user.access_token);

    const idle = await get(
      "/api/v1/settings/logs/stream?tail=0",
      user.access_token,
    );

    expect(active.status).toBe(200);
    expect(idle.status).toBe(200);

    const readers = [active.body!.getReader(), idle.body!.getReader()];

    try {
      for (const [index, reader] of readers.entries()) {
        let body = "";

        do {
          const part = await reader.read();

          expect(part.done).toBe(false);

          body += new TextDecoder().decode(part.value);
        } while (!body.includes(index ? "event: ready" : "before drain"));
      }

      const stopping = handle.shutdown();

      expect(handle.shutdown()).toBe(stopping);

      await expect(stopping).resolves.toBeUndefined();

      for (const reader of readers)
        expect((await reader.read()).done).toBe(true);

      // The module is imported once, but stream admission belongs to each boot.
      const next = await boot({
        rootDir: fileURLToPath(new URL("../", import.meta.url)),
        appEnv: "test",
        handleSignals: false,
      });

      try {
        next.env.store.set("LOG_FILE", true);

        next.env.store.set("LOG_DIR", dir);

        next.env.store.set("LOG_BASENAME", "app");

        const address = next.server!.address();

        if (!address || typeof address === "string")
          throw new Error("No listener after restart");

        const response = await fetch(
          "http://127.0.0.1:" +
            address.port +
            "/api/v1/settings/logs/stream?tail=0",
          {
            headers: { authorization: "Bearer " + user.access_token },
          },
        );

        expect(response.status).toBe(200);

        await response.body?.cancel();
      } finally {
        await next.shutdown();
      }
    } finally {
      await Promise.all(readers.map((reader) => reader.cancel()));
    }
  });
});

async function patch(path: string, body: unknown, token: string) {
  return fetch(base + path, {
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
  await handle.ctx.models!.get("User").updateOne({ _id: admin.userId }, { role: "admin" });

  expect((await get("/api/v1/config", ordinary.access_token)).status).toBe(403);

  const response = await get("/api/v1/config", admin.access_token);
  expect(response.status).toBe(200);
  const { data } = (await response.json()) as { data: { store: { ready: boolean }; modules: Record<string, unknown>[] } };
  expect(data.store.ready).toBe(true);
  expect(data.modules.map((module) => module.name)).toEqual(handle.ctx.modules.map((module) => module.name));

  const auth = data.modules.find((module) => module.name === "auth") as { variables: Record<string, unknown>[]; settings: { values: Record<string, unknown>; version: number }; routes: Record<string, unknown>[] };
  const secret = auth.variables.find((variable) => variable.name === "JWT_ACCESS_SECRET")!;
  expect(secret).toMatchObject({ is_secret: true, is_set: true, value: null, default: null });
  expect(JSON.stringify(data)).not.toContain(process.env.JWT_ACCESS_SECRET);
  expect(auth.settings.values).toMatchObject({ accessTtl: "15m" });
  expect(auth.routes).toContainEqual(expect.objectContaining({ id: "auth:login", method: "POST", roles: expect.arrayContaining(["guest"]) }));

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
  expect(handle.ctx.config.hello).toEqual({ greeting: "Howdy" });
  const greeted = (await (await fetch(base + "/api/v1/hello")).json()) as { data: { message: string } };
  expect(greeted.data.message).toMatch(/^Howdy/);

  const audit = await handle.ctx.models!.get("ConfigAudit").find({ actor: user.userId }).sort({ recorded_at: -1 }).lean();
  expect(audit[0]).toMatchObject({ action: "settings.change_requested", module: "hello", keys: ["greeting"], version: before, actor_role: "sysadmin" });
  expect(JSON.stringify(audit)).not.toContain("Howdy");

  expect((await patch("/api/v1/config/nope", { values: {} }, user.access_token)).status).toBe(404);

  await handle.ctx.settings.set("hello", { greeting: "Hello" }, { id: "tests" });
});

test("an authenticated request on a cache hit performs no database read", async () => {
  const user = await account();
  const cold = await get("/api/v1/auth/me", user.access_token);
  expect(cold.status).toBe(200);

  const User = handle.ctx.models!.get("User");
  const Session = handle.ctx.models!.get("Session");
  const Revoked = handle.ctx.models!.get("RevokedToken");
  const reads = [
    vi.spyOn(User, "findById"), vi.spyOn(User, "findOne"),
    vi.spyOn(Session, "findOne"), vi.spyOn(Session, "find"),
    vi.spyOn(Revoked, "countDocuments"),
  ];
  try {
    const warm = await get("/api/v1/auth/me", user.access_token);
    expect(warm.status).toBe(200);
    expect(await warm.json()).toMatchObject({ data: { user: { email: user.email, role: "user" }, session: { sid: expect.any(String) } } });
    expect(reads.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0, 0, 0]);
  } finally {
    reads.forEach((spy) => spy.mockRestore());
  }
});

test("a revocation on one replica is refused on the very next request on another", async () => {
  const next = await boot({
    rootDir: fileURLToPath(new URL("../", import.meta.url)),
    appEnv: "test",
    handleSignals: false,
  });
  try {
    const address = next.server!.address();
    if (!address || typeof address === "string") throw new Error("No listener on the second replica");
    const other = "http://127.0.0.1:" + address.port;
    const me = (token: string) => fetch(other + "/api/v1/auth/me", { headers: { authorization: "Bearer " + token } });

    // Logged out on the first replica: the second one, which had the
    // identity cached from its own request, refuses the next one.
    const first = await account();
    expect((await get("/api/v1/auth/me", first.access_token)).status).toBe(200);
    expect((await me(first.access_token)).status).toBe(200);
    expect((await post("/api/v1/auth/logout", {}, first.access_token)).status).toBe(200);
    expect((await me(first.access_token)).status).toBe(401);

    // A password change, a session ended by its owner, and a soft-deleted
    // account: every path that revokes forgets the cached identity first.
    const second = await account();
    expect((await me(second.access_token)).status).toBe(200);
    const changed = await post("/api/v1/auth/password", { password: randomBytes(24).toString("hex") }, second.access_token);
    expect(changed.status).toBe(200);
    expect((await me(second.access_token)).status).toBe(401);

    const third = await account();
    expect((await me(third.access_token)).status).toBe(200);
    const { verify } = await import("../modules/auth/helpers/tokens.ts");
    const claims = verify(handle.ctx, third.access_token, "access")!;
    expect((await fetch(base + "/api/v1/auth/sessions/" + claims.sid, { method: "DELETE", headers: { authorization: "Bearer " + third.access_token } })).status).toBe(200);
    expect((await me(third.access_token)).status).toBe(401);

    const fourth = await account();
    expect((await me(fourth.access_token)).status).toBe(200);
    const admin = await sysadmin();
    expect((await fetch(base + "/users/" + encodeURIComponent(fourth.email), { method: "DELETE", headers: { authorization: "Bearer " + admin.access_token } })).status).toBe(200);
    expect((await me(fourth.access_token)).status).toBe(401);
  } finally {
    await next.shutdown();
  }
});
