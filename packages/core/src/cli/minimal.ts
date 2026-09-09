/** Small, infrastructure-free starter. The production renderer remains separate. */
const json = (value: unknown): string => JSON.stringify(value, null, 2) + "\n";

export function starterTests(production: boolean): string {
  return `import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
${production ? 'import { z } from "zod/v4";' : ''}
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { boot, inspectRoutes, type BootHandle } from "@tulipes/core/boot";
import { extract, toOpenApi, toPostman } from "@tulipes/spec";

let handle: BootHandle;
let base: string;
beforeAll(async () => {
  vi.stubEnv("PORT", "0");
  ${production ? `if (!process.env.TEST_MONGO_URI || !process.env.TEST_REDIS_URL) {
    throw new Error("Tests require dedicated TEST_MONGO_URI and TEST_REDIS_URL services");
  }
  vi.stubEnv("MONGO_URI", process.env.TEST_MONGO_URI);
  vi.stubEnv("REDIS_URL", process.env.TEST_REDIS_URL);
  vi.stubEnv("JWT_ACCESS_SECRET", randomBytes(32).toString("hex"));
  vi.stubEnv("JWT_REFRESH_SECRET", randomBytes(32).toString("hex"));
  vi.stubEnv("AUTH_ADMIN_EMAIL", "test-admin@example.test");
  vi.stubEnv("AUTH_ADMIN_PASSWORD", randomBytes(32).toString("hex"));
  vi.stubEnv("LOG_FILE", "false");
  vi.stubEnv("LOG_CONSOLE", "false");` : ''}
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
${production ? `
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
` : `
test("health needs no external infrastructure", async () => {
  expect(handle.ctx.models).toBeUndefined();
  expect(handle.ctx.queues).toBeUndefined();
  const response = await fetch(base + "/health");
  expect(await response.json()).toMatchObject({ success: true, data: { status: "ok" } });
});
`}`;
}

export function renderMinimalProject(name: string, coreVersion: string): [string, string][] {
  const core = `^${coreVersion}`;
  const manifest = (module: string, priority?: number, dependencies: Record<string, string> = {}) => json({
    name: `@${name}/${module}`, private: true, type: "module", version: "0.0.0",
    tulipes: { offline: true, ...(priority === undefined ? {} : { tier: "sys", priority }) },
    dependencies: { "@tulipes/core": core, ...dependencies },
  });
  return [
    ["package.json", json({
      name, private: true, type: "module", packageManager: "yarn@4.18.0", engines: { node: ">=24.0.0 <25" },
      workspaces: ["modules/*"],
      scripts: { dev: "tulipes dev", start: "tsx app.ts", sync: "tulipes sync", check: "tulipes env:check",
        typecheck: "tsc --noEmit", test: "vitest run", spec: "tulipes spec --offline --openapi docs/openapi.json --postman docs/collection.json" },
      dependencies: { "@tulipes/core": core, express: "^5", zod: "^3.25" },
      devDependencies: { "@tulipes/spec": "^0.3.0-rc.2", "@types/express": "^5", "@types/node": "^24", tsx: "^4", typescript: "^7", vitest: "^5.0.0", vite: "^8.2.2" },
    })],
    ["tsconfig.json", json({ compilerOptions: { target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
      noUncheckedIndexedAccess: true, verbatimModuleSyntax: true, skipLibCheck: true, noEmit: true }, include: ["app.ts", "modules", "types", "config", "tests"] })],
    [".yarnrc.yml", "nodeLinker: node-modules\n"],
    [".gitignore", "node_modules/\n.envs/\ncoverage/\nlogs/\n"],
    ["app.ts", 'import { boot } from "@tulipes/core/boot";\n\nawait boot({ rootDir: import.meta.dirname, mode: "backend" });\n'],
    ["tests/app.test.ts", starterTests(false)],
    ["vitest.config.ts", "import { defineConfig } from \"vitest/config\";\n\nexport default defineConfig({ test: { include: [\"tests/**/*.test.ts\"], execArgv: [\"--import\", \"tsx\"] } });\n"],
    ["modules/core/package.json", manifest("core", 0)],
    ["modules/core/meta.variables.json", json({ variables: [{ name: "PORT", type: "number", default: 3000, description: "HTTP listener port" }] })],
    ["modules/core/module.acl.ts", `import type { AclBuilder } from "@tulipes/core/acl";
export default function permissions(acl: AclBuilder) {
  acl.defineRole("guest").allow("guest", "core:health");
}
`],
    ["modules/security/package.json", manifest("security", 10, { express: "^5", helmet: "^8" })],
    ["modules/security/routes/security.routes.ts", `import express from "express";
import helmet from "helmet";
import { defineRoutes } from "@tulipes/core/http";
export default defineRoutes(({ app }) => {
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "100kb" }));
});
`],
    ["modules/hello/package.json", manifest("hello", undefined, { express: "^5", zod: "^3.25" })],
    ["modules/hello/module.acl.ts", `import type { AclBuilder } from "@tulipes/core/acl";
export default function permissions(acl: AclBuilder) { acl.allow("guest", "hello:read"); }
`],
    ["modules/hello/i18n/en.json", json({ greeting: "Hello" })],
    ["modules/hello/routes/hello.routes.ts", `import { Router } from "express";
import { z } from "zod/v4";
import { defineRoutes } from "@tulipes/core/http";
export default defineRoutes(({ app, rai, routes }) => {
  const router = Router();
  router.get("/hello", rai({ id: "hello:read", name: "Hello", returns: z.object({ message: z.string() }) }), (req, res) => {
    res.respond({ data: { message: req.t("greeting") } });
  });
  routes.mount(app, "/api/v1", router);
});
`],
    ["modules/hello/routes/health.routes.ts", `import { Router } from "express";
import { defineRoutes } from "@tulipes/core/http";
export default defineRoutes(({ rai }) => {
  const router = Router();
  router.get("/health", rai({ id: "core:health", name: "Health" }), (_req, res) => {
    res.respond({ data: { status: "ok" } });
  });
  return router;
});
`],
    ["README.md", `# ${name}\n\nMinimal Tulipes API. Requires Node 24.x and Corepack; no MongoDB, Redis or credentials.\n\n\`\`\`sh\ncorepack enable\nyarn install\nyarn sync\nyarn typecheck\nyarn check\nyarn test\nyarn spec\nyarn dev\n\`\`\`\n\nOpen http://localhost:3000/api/v1/hello or http://localhost:3000/health.\n\nRoutes declare a RAI and use res.respond. Middleware belongs to sys modules.\nCore still installs optional infrastructure libraries, but this app opens no infrastructure connections.\nThe production preset adds auth, users, settings, queues and deployment examples:\n\n\`tulipes init another-api --preset production\`\n`],
  ];
}
