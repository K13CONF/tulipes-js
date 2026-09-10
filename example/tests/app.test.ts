import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { boot, inspectRoutes, type BootHandle } from "@tulipes/core/boot";
import { extract, toOpenApi, toPostman } from "@tulipes/spec";

let handle: BootHandle;
let base: string;
beforeAll(async () => {
  vi.stubEnv("PORT", "0");
  vi.stubEnv("TRUST_PROXY_CIDRS", "127.0.0.1/32,::1/128");
  if (!process.env.TEST_MONGO_URI || !process.env.TEST_REDIS_URL) {
    throw new Error("Tests require dedicated TEST_MONGO_URI and TEST_REDIS_URL services");
  }
  vi.stubEnv("MONGO_URI", process.env.TEST_MONGO_URI);
  vi.stubEnv("REDIS_URL", process.env.TEST_REDIS_URL);
  vi.stubEnv("RATE_LIMIT_NAMESPACE", "test-" + randomBytes(12).toString("hex"));
  vi.stubEnv("AUTH_RATE_LIMIT", "200");
  vi.stubEnv("AUTH_SESSION_RATE_LIMIT", "1000");
  vi.stubEnv("SETTINGS_RATE_LIMIT", "200");
  vi.stubEnv("JWT_ACCESS_SECRET", randomBytes(32).toString("hex"));
  vi.stubEnv("JWT_REFRESH_SECRET", randomBytes(32).toString("hex"));
  vi.stubEnv("AUTH_ADMIN_EMAIL", "test-admin@example.test");
  vi.stubEnv("AUTH_ADMIN_PASSWORD", randomBytes(32).toString("hex"));
  vi.stubEnv("LOG_LEVEL", "fatal");
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

test("offline declarations describe the mounted runtime routes and schemas", async () => {
  const context = await inspectRoutes({ rootDir: fileURLToPath(new URL("../", import.meta.url)) });
  const offline = { ...extract(context), app: { name: "parity" } };
  const runtime = { ...extract(handle.ctx), app: { name: "parity" } };
  expect(await toOpenApi(offline)).toEqual(await toOpenApi(runtime));
  expect(await toPostman(offline)).toEqual(await toPostman(runtime));
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

async function account() {
  const credentials = { email: randomBytes(12).toString("hex") + "@example.test", password: randomBytes(24).toString("hex") };
  const response = await post("/api/v1/auth/register", credentials);
  expect(response.status).toBe(201);
  const body = await response.json();
  const { user } = z.object({ data: z.object({ user: z.object({ id: z.string() }) }) }).parse(body).data;
  return { ...tokens.parse(body).data, ...credentials, userId: user.id };
}

async function get(path: string, token: string) {
  return fetch(base + path, { headers: { authorization: "Bearer " + token } });
}

async function assertRejected(pair: { access_token: string; refresh_token: string }) {
  expect((await get("/api/v1/auth/me", pair.access_token)).status).toBe(401);
  expect((await post("/api/v1/auth/refresh", { refresh_token: pair.refresh_token })).status).toBe(401);
}

test("session expiry rejects access and refresh before TTL cleanup and hides the device", async () => {
  const initial = await account();
  const Session = handle.ctx.models!.get("Session");
  // Keep the row in Mongo's future; advance only the app clock to the exact
  // boundary so asynchronous TTL deletion cannot make this regression pass.
  const expires = new Date(Date.now() + 120_000);
  await Session.updateOne({ user: initial.userId }, { expires_at: expires });
  const login = await post("/api/v1/auth/login", { email: initial.email, password: initial.password });
  expect(login.status).toBe(200);
  const other = tokens.parse(await login.json()).data;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(expires);
  try {
    const sessions = await get("/api/v1/auth/sessions", other.access_token);
    expect(sessions.status).toBe(200);
    expect.soft(z.object({ data: z.array(z.unknown()) }).parse(await sessions.json()).data).toHaveLength(1);
    // Check both independently so a failed access assertion cannot hide refresh.
    expect.soft((await get("/api/v1/auth/me", initial.access_token)).status).toBe(401);
    expect.soft((await post("/api/v1/auth/refresh", { refresh_token: initial.refresh_token })).status).toBe(401);
    expect(await Session.countDocuments({ user: initial.userId })).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});

test("a session reassigned to another account cannot authenticate or refresh its old tokens", async () => {
  const initial = await account();
  const other = await account();
  await handle.ctx.models!.get("Session").updateOne({ user: initial.userId }, { user: other.userId });
  expect.soft((await get("/api/v1/auth/me", initial.access_token)).status).toBe(401);
  expect.soft((await post("/api/v1/auth/refresh", { refresh_token: initial.refresh_token })).status).toBe(401);
  expect((await get("/api/v1/auth/me", other.access_token)).status).toBe(200);
});

test("password change in the same JWT second revokes both devices and keeps the replacement usable", async () => {
  // Freeze only Date, leaving HTTP, Mongo and bcrypt timers operational.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Math.floor(Date.now() / 1000) * 1000 + 100));
  try {
    const initial = await account();
    const login = await post("/api/v1/auth/login", { email: initial.email, password: initial.password });
    expect(login.status).toBe(200);
    const other = tokens.parse(await login.json()).data;
    vi.setSystemTime(new Date(Date.now() + 500));
    const password = randomBytes(24).toString("hex");
    const changed = await post("/api/v1/auth/password", { password }, initial.access_token);
    expect(changed.status).toBe(200);
    const replacement = tokens.parse(await changed.json()).data;
    await assertRejected(initial);
    await assertRejected(other);
    expect((await get("/api/v1/auth/me", replacement.access_token)).status).toBe(200);
    expect((await post("/api/v1/auth/refresh", { refresh_token: replacement.refresh_token })).status).toBe(200);
    expect((await post("/api/v1/auth/login", { email: initial.email, password: initial.password })).status).toBe(401);
    expect((await post("/api/v1/auth/login", { email: initial.email, password })).status).toBe(200);
  } finally {
    vi.useRealTimers();
  }
});

test("refresh racing with device revocation cannot leave a usable token pair", async () => {
  const initial = await account();
  const login = await post("/api/v1/auth/login", { email: initial.email, password: initial.password });
  expect(login.status).toBe(200);
  const other = tokens.parse(await login.json()).data;
  const identity = await get("/api/v1/auth/me", other.access_token);
  const { session } = z.object({ data: z.object({ session: z.object({ sid: z.string() }) }) }).parse(await identity.json()).data;
  const [revoked, refreshed] = await Promise.all([
    fetch(base + "/api/v1/auth/sessions/" + session.sid, { method: "DELETE", headers: { authorization: "Bearer " + initial.access_token } }),
    post("/api/v1/auth/refresh", { refresh_token: other.refresh_token }),
  ]);
  expect(revoked.status).toBe(200);
  expect([200, 401]).toContain(refreshed.status);
  await assertRejected(other);
  if (refreshed.status === 200) await assertRejected(tokens.parse(await refreshed.json()).data);
  expect((await get("/api/v1/auth/me", initial.access_token)).status).toBe(200);
});

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test.each(["login", "password", "cleanup", "credential-write"])("a paused %s cannot create a valid session after a later password change", async (operation) => {
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
  const spy = operation === "credential-write"
    ? vi.spyOn(credentials, "findOneAndUpdate").mockImplementationOnce(async (...args) => {
      entered.resolve();
      await release.promise;
      return replace(...args);
    })
    : operation === "cleanup"
    ? vi.spyOn(collection, "deleteMany").mockImplementationOnce(async (...args) => {
      entered.resolve();
      await release.promise;
      return remove(...args);
    })
    : vi.spyOn(collection, "insertOne").mockImplementationOnce(async (...args) => {
    entered.resolve();
    await release.promise;
    return insert(...args);
  });
  const pending = operation === "login"
    ? post("/api/v1/auth/login", { email: initial.email, password: initial.password })
    : post("/api/v1/auth/password", { password: firstPassword }, initial.access_token);
  try {
    // The real request has verified/written its password and reached session
    // insertion or cleanup. Complete a later change before releasing that write.
    await Promise.race([entered.promise, pending.then(() => { throw new Error("Request never reached the session barrier"); })]);
    let access = initial.access_token;
    if (operation === "password" || operation === "cleanup") {
      const login = await post("/api/v1/auth/login", { email: initial.email, password: firstPassword });
      expect(login.status).toBe(200);
      access = tokens.parse(await login.json()).data.access_token;
    }
    const changed = await post("/api/v1/auth/password", { password: latestPassword }, access);
    expect(changed.status).toBe(200);
    const latest = tokens.parse(await changed.json()).data;
    release.resolve();
    const stale = await pending;
    expect.soft(stale.status).toBe(401);
    if (stale.status === 200) await assertRejected(tokens.parse(await stale.json()).data);
    expect((await get("/api/v1/auth/me", latest.access_token)).status).toBe(200);
    expect((await post("/api/v1/auth/login", { email: initial.email, password: latestPassword })).status).toBe(200);
  } finally {
    release.resolve();
    await pending;
    spy.mockRestore();
  }
});

test("failed session cleanup after password replacement cannot preserve old sessions", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Math.floor(Date.now() / 1000) * 1000 + 100));
  try {
    const initial = await account();
    const password = randomBytes(24).toString("hex");
    const spy = vi.spyOn(handle.ctx.models!.get("Session").collection, "deleteMany")
      .mockRejectedValueOnce(new Error("injected cleanup failure"));
    try {
      const changed = await post("/api/v1/auth/password", { password }, initial.access_token);
      expect(changed.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(await handle.ctx.models!.get("Session").countDocuments({ user: initial.userId })).toBe(1);
    expect.soft((await get("/api/v1/auth/me", initial.access_token)).status).toBe(401);
    expect.soft((await post("/api/v1/auth/refresh", { refresh_token: initial.refresh_token })).status).toBe(401);
    expect((await post("/api/v1/auth/login", { email: initial.email, password: initial.password })).status).toBe(401);
    const login = await post("/api/v1/auth/login", { email: initial.email, password });
    expect(login.status).toBe(200);
    const current = tokens.parse(await login.json()).data;
    const sessions = await get("/api/v1/auth/sessions", current.access_token);
    expect(z.object({ data: z.array(z.unknown()) }).parse(await sessions.json()).data).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

test("a failed credential write preserves the old password and session", async () => {
  const initial = await account();
  const password = randomBytes(24).toString("hex");
  const spy = vi.spyOn(handle.ctx.models!.get("Credential").collection, "findOneAndUpdate")
    .mockRejectedValueOnce(new Error("injected credential failure"));
  try {
    expect((await post("/api/v1/auth/password", { password }, initial.access_token)).status).toBe(500);
  } finally {
    spy.mockRestore();
  }
  expect((await get("/api/v1/auth/me", initial.access_token)).status).toBe(200);
  expect((await post("/api/v1/auth/refresh", { refresh_token: initial.refresh_token })).status).toBe(200);
  expect((await post("/api/v1/auth/login", { email: initial.email, password: initial.password })).status).toBe(200);
  expect((await post("/api/v1/auth/login", { email: initial.email, password })).status).toBe(401);
});

test("legacy credentials upgrade on login while sessions without a version require reauthentication", async () => {
  const initial = await account();
  const Credential = handle.ctx.models!.get("Credential");
  const Session = handle.ctx.models!.get("Session");
  // Use collection writes to simulate persisted data from the previous starter.
  const credential = await Credential.findOne({ user: initial.userId }).orFail();
  await Credential.collection.updateOne({ _id: credential._id }, { $unset: { version: "" } });
  await Session.collection.updateMany({ user: credential.get("user") }, { $unset: { credential_version: "" } });
  await assertRejected(initial);
  const login = await post("/api/v1/auth/login", { email: initial.email, password: initial.password });
  expect(login.status).toBe(200);
  const current = tokens.parse(await login.json()).data;
  expect((await get("/api/v1/auth/me", current.access_token)).status).toBe(200);
  await assertRejected(initial);
});

test("a legacy login cannot upgrade credentials replaced while its verification was in flight", async () => {
  const initial = await account();
  const Credential = handle.ctx.models!.get("Credential");
  const row = await Credential.findOne({ user: initial.userId }).orFail();
  await Credential.collection.updateOne({ _id: row._id }, { $unset: { version: "" } });
  const update = Credential.collection.updateOne.bind(Credential.collection);
  const entered = barrier();
  const release = barrier();
  const spy = vi.spyOn(Credential.collection, "updateOne").mockImplementationOnce(async (...args) => {
    entered.resolve();
    await release.promise;
    return update(...args);
  });
  const pending = post("/api/v1/auth/login", { email: initial.email, password: initial.password });
  try {
    await Promise.race([entered.promise, pending.then(() => { throw new Error("Login never reached the credential barrier"); })]);
    const password = randomBytes(24).toString("hex");
    const { setPassword } = await import("../modules/auth/helpers/passwords.js");
    await setPassword(handle.ctx, initial.userId, password);
    release.resolve();
    expect((await pending).status).toBe(401);
    expect((await post("/api/v1/auth/login", { email: initial.email, password })).status).toBe(200);
  } finally {
    release.resolve();
    await pending;
    spy.mockRestore();
  }
});

async function sysadmin() {
  const user = await account();
  await handle.ctx.models!.get("User").updateOne({ _id: user.userId }, { role: "sysadmin" });
  return user;
}

async function settingsFiles(run: (files: { env: string; locale: string }) => Promise<void>) {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "tulipes-settings-test-"));
  const env = join(root, ".env.test");
  const locale = join(root, "i18n", "en.json");
  const manifest = handle.ctx.modules.find(entry => entry.name === "settings")!;
  const originalDir = manifest.dir;
  const originalEnv = handle.ctx.Environment.envFile;
  const originalPassword = process.env.AUTH_ADMIN_PASSWORD;
  await mkdir(join(root, "i18n"));
  await writeFile(env, "# unchanged\n");
  await writeFile(locale, "{}\n");
  // Route real file operations into disposable files, never the reference app.
  Object.defineProperty(handle.ctx.Environment, "envFile", { value: env });
  Object.defineProperty(manifest, "dir", { value: root });
  try { await run({ env, locale }); }
  finally {
    Object.defineProperty(handle.ctx.Environment, "envFile", { value: originalEnv });
    Object.defineProperty(manifest, "dir", { value: originalDir });
    if (originalPassword === undefined) delete process.env.AUTH_ADMIN_PASSWORD;
    else process.env.AUTH_ADMIN_PASSWORD = originalPassword;
    await rm(root, { recursive: true, force: true });
  }
}

async function put(path: string, body: unknown, token: string) {
  return fetch(base + path, { method: "PUT", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify(body) });
}

test("secret reveal persists an acknowledged audit even with fatal-only logging", async () => {
  const user = await sysadmin();
  const Audit = handle.ctx.models!.get("AuditEvent");
  const insert = vi.spyOn(Audit.collection, "insertOne");
  try {
    const response = await get("/api/v1/settings/variables/AUTH_ADMIN_PASSWORD?reveal=true", user.access_token);
    expect(response.status).toBe(200);
    const body = z.object({ data: z.object({ value: z.string() }) }).parse(await response.json());
    expect(body.data.value === process.env.AUTH_ADMIN_PASSWORD).toBe(true);
    const event = await Audit.findOne({ actor: user.userId }).lean();
    expect(event).toMatchObject({ action: "variable.reveal_requested", actor_role: "sysadmin", variable: "AUTH_ADMIN_PASSWORD" });
    expect(JSON.stringify(event).includes(body.data.value)).toBe(false);
    expect(insert.mock.calls[0]?.[1]).toMatchObject({ w: "majority", j: true, wtimeout: 5000 });
  } finally { insert.mockRestore(); }
});

test.each(["reveal", "variable", "translations", "reboot"])("audit failure blocks %s without exposing sink errors or changing files", async (action) => {
  const user = await sysadmin();
  const canary = randomBytes(24).toString("hex");
  const Audit = handle.ctx.models!.get("AuditEvent");
  const insert = vi.spyOn(Audit.collection, "insertOne").mockRejectedValue(new Error(canary));
  // Prevent a real daemon connection even when running this test against the bug.
  const specifier = "pm2";
  const pm2 = (await import(specifier)).default;
  const connect = vi.spyOn(pm2, "connect").mockImplementation(() => { throw new Error("unexpected restart"); });
  const oldHome = process.env.PM2_HOME;
  process.env.PM2_HOME = "/unused-settings-test";
  try {
    await settingsFiles(async files => {
      const { readFile } = await import("node:fs/promises");
      const oldPassword = process.env.AUTH_ADMIN_PASSWORD;
      const response = action === "reveal"
        ? await get("/api/v1/settings/variables/AUTH_ADMIN_PASSWORD?reveal=true", user.access_token)
        : action === "variable"
          ? await put("/api/v1/settings/variables/AUTH_ADMIN_PASSWORD", { value: canary }, user.access_token)
          : action === "translations"
            ? await put("/api/v1/settings/i18n/settings/en", { translations: { text: canary } }, user.access_token)
            : await post("/api/v1/settings/reboot", {}, user.access_token);
      expect.soft(response.status).toBe(503);
      const body = await response.text();
      expect.soft(body.includes(canary)).toBe(false);
      expect.soft(body.includes(oldPassword!)).toBe(false);
      expect.soft(await readFile(files.env, "utf8")).toBe("# unchanged\n");
      expect.soft(await readFile(files.locale, "utf8")).toBe("{}\n");
      expect.soft(process.env.AUTH_ADMIN_PASSWORD === oldPassword).toBe(true);
      expect.soft(connect).not.toHaveBeenCalled();
    });
  } finally {
    insert.mockRestore(); connect.mockRestore();
    if (oldHome === undefined) delete process.env.PM2_HOME;
    else process.env.PM2_HOME = oldHome;
  }
});

test("settings mutation waits for audit acknowledgment and stores no old or new value", async () => {
  const user = await sysadmin();
  const Audit = handle.ctx.models!.get("AuditEvent");
  const insert = Audit.collection.insertOne.bind(Audit.collection);
  const entered = barrier();
  const release = barrier();
  const spy = vi.spyOn(Audit.collection, "insertOne").mockImplementationOnce(async (...args) => {
    entered.resolve();
    await release.promise;
    return insert(...args);
  });
  try {
    await settingsFiles(async files => {
      const { readFile } = await import("node:fs/promises");
      const value = randomBytes(24).toString("hex");
      const before = process.env.AUTH_ADMIN_PASSWORD!;
      const pending = put("/api/v1/settings/variables/AUTH_ADMIN_PASSWORD", { value }, user.access_token);
      try {
        await Promise.race([entered.promise, pending.then(() => { throw new Error("Mutation skipped the audit barrier"); })]);
        expect(await readFile(files.env, "utf8")).toBe("# unchanged\n");
        expect(process.env.AUTH_ADMIN_PASSWORD === before).toBe(true);
        release.resolve();
        expect((await pending).status).toBe(200);
        expect((await readFile(files.env, "utf8")).includes(value)).toBe(true);
        const event = await Audit.findOne({ actor: user.userId }).lean();
        expect(event).toMatchObject({ action: "variable.change_requested", variable: "AUTH_ADMIN_PASSWORD" });
        expect(JSON.stringify(event).includes(value) || JSON.stringify(event).includes(before)).toBe(false);
      } finally { release.resolve(); await pending; }
    });
  } finally { spy.mockRestore(); }
});

test("ordinary administrators cannot reveal settings secrets or create an audit event", async () => {
  const user = await account();
  await handle.ctx.models!.get("User").updateOne({ _id: user.userId }, { role: "admin" });
  expect((await get("/api/v1/settings/variables/AUTH_ADMIN_PASSWORD?reveal=true", user.access_token)).status).toBe(403);
  expect(await handle.ctx.models!.get("AuditEvent").countDocuments({ actor: user.userId })).toBe(0);
});

test("configured proxy trust supplies the same client IP to sessions and durable audits", async () => {
  const user = await sysadmin();
  const headers = { "X-Forwarded-For": "203.0.113.200, 198.51.100.19" };
  const login = await fetch(base + "/api/v1/auth/login", {
    method: "POST", headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  expect(login.status).toBe(200);
  const pair = tokens.parse(await login.json()).data;
  const identity = await get("/api/v1/auth/me", pair.access_token);
  expect(await identity.json()).toMatchObject({ data: { session: { ip: "198.51.100.19" } } });
  const revealed = await fetch(base + "/api/v1/settings/variables/AUTH_ADMIN_PASSWORD?reveal=true", {
    headers: { ...headers, authorization: "Bearer " + pair.access_token },
  });
  expect(revealed.status).toBe(200);
  expect(await handle.ctx.models!.get("AuditEvent").findOne({ actor: user.userId }).lean()).toMatchObject({ ip: "198.51.100.19" });
});


test.each(["auth/login", "settings/modules"])("%s limits attempts before parsing or authentication", async path => {
  const responses = await Promise.all(Array.from({ length: 201 }, (_, index) => fetch(base + "/api/v1/" + path, {
    method: path.startsWith("auth") ? "POST" : "GET",
    headers: { "X-Forwarded-For": "203.0.113." + (index % 250 + 1) + ", 198.51.100.88", "content-type": "application/json" },
    ...(path.startsWith("auth") ? { body: "{" } : {}),
  })));
  expect(responses.filter(response => response.status === 429)).toHaveLength(1);
  const blocked = responses.find(response => response.status === 429)!;
  expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  expect(await blocked.json()).toMatchObject({ success: false, errors: [{ code: "TOO_MANY_REQUESTS" }] });
  expect((await fetch(base + "/api/v1/hello")).status).toBe(200);
});


test.each(["symlink", "hardlink", "directory-link", "oversized"])("settings translation reads and writes reject %s files", async kind => {
  const user = await sysadmin();
  await settingsFiles(async files => {
    const { writeFile, readFile, unlink, symlink, link, rename } = await import("node:fs/promises");
    const { dirname, join } = await import("node:path");
    const outside = join(dirname(files.env), "outside.json");
    const canary = randomBytes(24).toString("hex");
    const original = JSON.stringify({ secret: canary });
    await writeFile(outside, original);
    if (kind === "directory-link") {
      await rename(dirname(files.locale), dirname(files.locale) + "-original");
      await symlink(dirname(files.locale) + "-original", dirname(files.locale));
    } else {
      await unlink(files.locale);
      if (kind === "symlink") await symlink(outside, files.locale);
      else if (kind === "hardlink") await link(outside, files.locale);
      else await writeFile(files.locale, " ".repeat(1024 * 1024 + 1));
    }
    for (const response of [await get("/api/v1/settings/i18n/settings/en", user.access_token),
      await put("/api/v1/settings/i18n/settings/en", { translations: { changed: true } }, user.access_token)]) {
      expect(response.status).toBe(kind === "oversized" ? 413 : 409);
      expect((await response.text()).includes(canary)).toBe(false);
    }
    expect(await readFile(outside, "utf8")).toBe(original);
  });
});

test("linked missing-translation files cannot leak through the module summary", async () => {
  const user = await sysadmin();
  await settingsFiles(async files => {
    const { writeFile, symlink } = await import("node:fs/promises");
    const { dirname, join } = await import("node:path");
    const outside = join(dirname(files.env), "outside.json");
    const canary = randomBytes(24).toString("hex");
    await writeFile(outside, JSON.stringify({ [canary]: "private" }));
    await symlink(outside, join(dirname(files.locale), "en.missing.json"));
    const response = await get("/api/v1/settings/modules", user.access_token);
    expect(response.status).toBe(409);
    expect((await response.text()).includes(canary)).toBe(false);
  });
});

test("linked env files cannot modify their target or the live process environment", async () => {
  const user = await sysadmin();
  await settingsFiles(async files => {
    const { writeFile, readFile, unlink, symlink } = await import("node:fs/promises");
    const outside = files.env + "-outside";
    await writeFile(outside, "# unchanged\n");
    await unlink(files.env);
    await symlink(outside, files.env);
    const previous = process.env.AUTH_ADMIN_PASSWORD;
    const response = await put("/api/v1/settings/variables/AUTH_ADMIN_PASSWORD", { value: randomBytes(24).toString("hex") }, user.access_token);
    expect(response.status).toBe(409);
    expect(await readFile(outside, "utf8")).toBe("# unchanged\n");
    expect(process.env.AUTH_ADMIN_PASSWORD).toBe(previous);
  });
});


test("module summaries bound the combined expansion of missing translation keys", async () => {
  const user = await sysadmin();
  await settingsFiles(async files => {
    const { writeFile } = await import("node:fs/promises");
    const { dirname, join } = await import("node:path");
    const entries = { ["x".repeat(3000)]: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [String(i), ""])) };
    for (const locale of ["en", "fr"]) await writeFile(join(dirname(files.locale), locale + ".missing.json"), JSON.stringify(entries));
    const response = await get("/api/v1/settings/modules", user.access_token);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ errors: [{ code: "SETTINGS_METADATA_TOO_LARGE" }] });
  });
});


test("translation replacement remains readable through the settings API", async () => {
  const user = await sysadmin();
  await settingsFiles(async files => {
    const translations = { greeting: "updated", nested: { empty: "No entries" } };
    const response = await put("/api/v1/settings/i18n/settings/en", { translations }, user.access_token);
    expect(response.status).toBe(200);
    const read = await get("/api/v1/settings/i18n/settings/en", user.access_token);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ data: { translations } });
    const { readFile } = await import("node:fs/promises");
    expect(JSON.parse(await readFile(files.locale, "utf8"))).toEqual(translations);
  });
});


async function logFiles(run: (dir: string) => Promise<void>) {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "tulipes-log-http-"));
  const env = handle.ctx.Environment;
  const previous = { file: env.get("LOG_FILE"), dir: env.get("LOG_DIR"), name: env.get("LOG_BASENAME") };
  env.store.set("LOG_FILE", true); env.store.set("LOG_DIR", dir); env.store.set("LOG_BASENAME", "app");
  try { await run(dir); }
  finally {
    env.store.set("LOG_FILE", previous.file); env.store.set("LOG_DIR", previous.dir); env.store.set("LOG_BASENAME", previous.name);
    await rm(dir, { recursive: true, force: true });
  }
}

test("log streaming enforces sysadmin access and never follows linked log targets", async () => {
  const ordinary = await account();
  const user = await sysadmin();
  await logFiles(async dir => {
    const { writeFile, symlink } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const canary = randomBytes(24).toString("hex");
    await writeFile(join(dir, "private"), canary);
    await symlink(join(dir, "private"), join(dir, "app-backend.log"));
    expect((await get("/api/v1/settings/logs/stream", ordinary.access_token)).status).toBe(403);
    const response = await get("/api/v1/settings/logs/stream", user.access_token);
    expect(response.status).toBe(409);
    expect((await response.text()).includes(canary)).toBe(false);
  });
});

test("log stream slots are capped per account and released on HTTP cancellation", async () => {
  const user = await sysadmin();
  await logFiles(async dir => {
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await writeFile(join(dir, "app-backend.2026-09-10.1.log"), JSON.stringify({ level: 30, msg: "retained line" }) + "\n");
    const first = await get("/api/v1/settings/logs/stream", user.access_token);
    const second = await get("/api/v1/settings/logs/stream", user.access_token);
    try {
      expect(first.status).toBe(200);
      expect(first.headers.get("content-type")).toContain("text/event-stream");
      const blocked = await get("/api/v1/settings/logs/stream", user.access_token);
      expect(blocked.status).toBe(429);
      expect(await blocked.json()).toMatchObject({ errors: [{ code: "TOO_MANY_LOG_STREAMS" }] });
    } finally { await first.body?.cancel(); await second.body?.cancel(); }
    let reopened: Response | undefined;
    await vi.waitFor(async () => {
      const response = await get("/api/v1/settings/logs/stream", user.access_token);
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
      } finally { await reader.cancel(); }
    } finally { if (!reopened!.body!.locked) await reopened!.body!.cancel(); }
  });
});

test("restart acknowledgment finishes before PM2 commands and retains its audit", async () => {
  const user = await sysadmin();
  const specifier = "pm2";
  const pm2 = (await import(specifier)).default as {
    connect(callback: (error?: Error) => void): void;
    list(
      callback: (error: Error | undefined, processes: unknown[]) => void,
    ): void;
    restart(id: number, callback: (error?: Error) => void): void;
    disconnect(): void;
  };
  const { realpathSync } = await import("node:fs");
  const root = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
  const oldHome = process.env.PM2_HOME;
  process.env.PM2_HOME = "/unused-restart-response-test";

  const connect = vi
    .spyOn(pm2, "connect")
    .mockImplementation((callback) => callback());
  const list = vi
    .spyOn(pm2, "list")
    .mockImplementation((callback) =>
      callback(undefined, [
        {
          name: "test-backend",
          pm_id: 1,
          pid: 1001,
          pm2_env: { pm_cwd: root },
        },
      ]),
    );
  const disconnect = vi.spyOn(pm2, "disconnect").mockImplementation(() => {});
  const restarted = barrier();
  const restart = vi
    .spyOn(pm2, "restart")
    .mockImplementation((_id, callback) => {
      restarted.resolve();
      callback();
    });

  try {
    const response = await post(
      "/api/v1/settings/reboot",
      {},
      user.access_token,
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { supervised: true, accepted: true, scheduled: ["test-backend"] },
    });

    await restarted.promise;
    expect(restart).toHaveBeenCalledWith(1, expect.any(Function));
    expect(
      await handle.ctx
        .models!.get("AuditEvent")
        .findOne({ actor: user.userId })
        .lean(),
    ).toMatchObject({ action: "reboot.requested" });
  } finally {
    connect.mockRestore();
    list.mockRestore();
    restart.mockRestore();
    disconnect.mockRestore();

    if (oldHome === undefined) delete process.env.PM2_HOME;
    else process.env.PM2_HOME = oldHome;
  }
});
