import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
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

function barrier() {
  let resolve!: () => void;

  const promise = new Promise<void>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

async function sysadmin() {
  const user = await account();

  await app.handle.ctx
    .models!.get("User")
    .updateOne({ _id: user.userId }, { role: "sysadmin" });

  return user;
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
  const collection = app.handle.ctx.models!.get("Session").collection;
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
    .spyOn(app.handle.ctx.models!.get("Session").collection, "findOneAndUpdate")
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
  const key = String(app.handle.ctx.config.auth!.jwtRefreshSecret);

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
  const collection = app.handle.ctx.models!.get("Session").collection;
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
  const cookieOnly = await fetch(app.base + "/api/v1/auth/me", {
    headers: { cookie },
  });

  const queryOnly = await fetch(
    app.base + "/api/v1/auth/me?access_token=" + initial.access_token,
  );

  expect(cookieOnly.status).toBe(401);
  expect(queryOnly.status).toBe(401);
  expect((await get("/api/v1/auth/me", initial.access_token)).status).toBe(200);

  // Cookie-only logout must also leave the real session usable.
  const logoutWithCookie = await fetch(app.base + "/api/v1/auth/logout", {
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
  const endpoint = app.base + "/api/v1/auth/refresh";
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

test("session expiry rejects access and refresh before TTL cleanup and hides the device", async () => {
  const initial = await account();
  const Session = app.handle.ctx.models!.get("Session");

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

  await app.handle.ctx
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
    fetch(app.base + "/api/v1/auth/sessions/" + session.sid, {
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

test.each(["login", "password", "cleanup", "credential-write"])(
  "a paused %s cannot create a valid session after a later password change",
  async (operation) => {
    const initial = await account();
    const firstPassword = randomBytes(24).toString("hex");
    const latestPassword = randomBytes(24).toString("hex");
    const collection = app.handle.ctx.models!.get("Session").collection;
    const insert = collection.insertOne.bind(collection);
    const remove = collection.deleteMany.bind(collection);
    const credentials = app.handle.ctx.models!.get("Credential").collection;
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
      .spyOn(app.handle.ctx.models!.get("Session").collection, "deleteMany")
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
      await app.handle.ctx
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
    .spyOn(app.handle.ctx.models!.get("Credential").collection, "findOneAndUpdate")
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
  const Credential = app.handle.ctx.models!.get("Credential");
  const Session = app.handle.ctx.models!.get("Session");

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
  const Credential = app.handle.ctx.models!.get("Credential");
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
      "../helpers/passwords.ts"
    );

    await setPassword(app.handle.ctx, initial.userId, password);

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

test("an authenticated request on a cache hit performs no database read", async () => {
  const user = await account();
  const cold = await get("/api/v1/auth/me", user.access_token);
  expect(cold.status).toBe(200);

  const User = app.handle.ctx.models!.get("User");
  const Session = app.handle.ctx.models!.get("Session");
  const Revoked = app.handle.ctx.models!.get("RevokedToken");
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

async function issue(token: string, body: unknown) {
  const response = await post("/api/v1/auth/tokens", body, token);
  return { status: response.status, body: await response.json() as { data: { token_id: string; secret: string; scopes: string[] | null } | null; errors: { code: string; field: string | null }[] } };
}

test("a failed login costs one bcrypt compare whether or not the email has an account", async () => {
  const known = await account();
  const compare = vi.spyOn(bcrypt, "compare");
  try {
    for (const email of [known.email, `nobody-${randomBytes(6).toString("hex")}@example.test`]) {
      compare.mockClear();
      const response = await post("/api/v1/auth/login", { email, password: "not-the-password" });
      expect(response.status).toBe(401);
      expect(compare).toHaveBeenCalledTimes(1);
    }
  } finally {
    compare.mockRestore();
  }
});

test("an API token is issued once, reaches what its role grants and its scopes cover, and is refused once revoked", async () => {
  const user = await account();
  const issued = await issue(user.access_token, { name: "claude-code laptop", scopes: ["hello:web:*"] });
  expect(issued.status).toBe(201);
  const { token_id, secret } = issued.body.data!;
  expect(secret).toMatch(new RegExp(`^${String(app.handle.ctx.config.app!.name)}_${token_id}_[a-f0-9]{64}$`));
  expect(issued.body.data!.scopes).toEqual(["hello:web:*"]);

  // In scope and granted to the role: reached. Granted but out of scope: refused as such.
  expect((await get("/api/v1/hello/secret", secret)).status).toBe(200);
  const outside = await get("/api/v1/auth/me", secret);
  expect(outside.status).toBe(403);
  expect(await outside.json()).toMatchObject({ errors: [{ code: "OUT_OF_SCOPE" }] });

  // Listed without the secret; the stored row holds only a hash.
  const listed = await (await get("/api/v1/auth/tokens", user.access_token)).json() as { data: unknown };
  expect(listed.data).toEqual([expect.objectContaining({ token_id, name: "claude-code laptop", scopes: ["hello:web:*"], last_used_at: expect.any(String) })]);
  expect(JSON.stringify(listed)).not.toContain(secret.split("_").at(-1));
  const row = await app.handle.ctx.models!.get("ApiToken").findOne({ token_id }).select("+secret_hash").lean() as unknown as { secret_hash: string };
  expect(row.secret_hash).not.toContain(secret.split("_").at(-1));

  // Another user cannot revoke it; its owner can, and the next request is a guest.
  const other = await account();
  expect((await fetch(app.base + "/api/v1/auth/tokens/" + token_id, { method: "DELETE", headers: { authorization: "Bearer " + other.access_token } })).status).toBe(404);
  expect((await fetch(app.base + "/api/v1/auth/tokens/" + token_id, { method: "DELETE", headers: { authorization: "Bearer " + user.access_token } })).status).toBe(200);
  expect((await get("/api/v1/hello/secret", secret)).status).toBe(401);
});

test("an API token cannot issue tokens, rejects bad scopes, expires, and dies with a password change", async () => {
  const user = await account();
  const { secret } = (await issue(user.access_token, { name: "unscoped" })).body.data!;
  expect((await get("/api/v1/auth/me", secret)).status).toBe(200);

  const minted = await issue(secret, { name: "successor" });
  expect(minted).toMatchObject({ status: 403, body: { errors: [{ code: "TOKEN_NEEDS_SESSION" }] } });
  expect((await issue(user.access_token, { name: "bad", scopes: ["users:read"] })).status).toBe(422);
  expect((await issue(user.access_token, { name: "bad", expires_in_days: 0 })).status).toBe(422);

  const expiring = (await issue(user.access_token, { name: "short", expires_in_days: 1 })).body.data!;
  await app.handle.ctx.models!.get("ApiToken").updateOne({ token_id: expiring.token_id }, { expires_at: new Date(Date.now() - 1000) });
  expect((await get("/api/v1/auth/me", expiring.secret)).status).toBe(401);

  // A forged secret for a real token id is not a caller.
  const forged = secret.replace(/[a-f0-9]{64}$/, "0".repeat(64));
  expect((await get("/api/v1/auth/me", forged)).status).toBe(401);

  const changed = await post("/api/v1/auth/password", { password: randomBytes(24).toString("hex") }, user.access_token);
  expect(changed.status).toBe(200);
  expect((await get("/api/v1/auth/me", secret)).status).toBe(401);
  const replacement = tokens.parse(await changed.json()).data.access_token;
  expect(await (await get("/api/v1/auth/tokens", replacement)).json()).toMatchObject({ data: [] });
});

test("an API token's last_used_at is written at most once a minute, on a cache hit as on a miss", async () => {
  const user = await account();
  const { secret } = (await issue(user.access_token, { name: "touch" })).body.data!;
  const tokens = app.handle.ctx.models!.get("ApiToken");
  const writes = vi.spyOn(tokens, "updateOne");
  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
  try {
    // A miss (written), then 61 s later a hit (written), then five hits a second apart (not).
    for (const step of [0, 61_000, 1_000, 1_000, 1_000, 1_000, 1_000]) {
      vi.setSystemTime(Date.now() + step);
      expect((await get("/api/v1/hello/secret", secret)).status).toBe(200);
    }
  } finally {
    vi.useRealTimers();
  }
  expect(writes).toHaveBeenCalledTimes(2);
});

test("a revoked API token is refused at once, even while its identity is cached", async () => {
  const user = await account();
  const { token_id, secret } = (await issue(user.access_token, { name: "cached" })).body.data!;
  expect((await get("/api/v1/hello/secret", secret)).status).toBe(200);
  expect((await get("/api/v1/hello/secret", secret)).status).toBe(200);
  expect((await fetch(app.base + "/api/v1/auth/tokens/" + token_id, { method: "DELETE", headers: { authorization: "Bearer " + user.access_token } })).status).toBe(200);
  expect((await get("/api/v1/hello/secret", secret)).status).toBe(401);
});

// Keep this test last: it boots a second replica, which configures passport
// (a process-wide singleton) with its own context and then shuts it down.
test("a revocation on one replica is refused on the very next request on another", async () => {
  const next = await boot({
    rootDir,
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
    const { verify } = await import("../helpers/tokens.ts");
    const claims = verify(app.handle.ctx, third.access_token, "access")!;
    expect((await fetch(app.base + "/api/v1/auth/sessions/" + claims.sid, { method: "DELETE", headers: { authorization: "Bearer " + third.access_token } })).status).toBe(200);
    expect((await me(third.access_token)).status).toBe(401);

    const fourth = await account();
    expect((await me(fourth.access_token)).status).toBe(200);
    const admin = await sysadmin();
    expect((await fetch(app.base + "/users/" + encodeURIComponent(fourth.email), { method: "DELETE", headers: { authorization: "Bearer " + admin.access_token } })).status).toBe(200);
    expect((await me(fourth.access_token)).status).toBe(401);
  } finally {
    await next.shutdown();
  }
});

