import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { Socket } from "node:net";
import { expect, test, vi } from "vitest";
import type { Ctx } from "../src/boot/contracts.ts";
import { extract } from "../../spec/src/extract.ts";
import { toOpenApi } from "../../spec/src/openapi.ts";
import { toPostman } from "../../spec/src/postman.ts";
import { fixture, url } from "./fixture.ts";

/**
 * Inspection is the normal boot with nothing acquired: every route mounted
 * through the same loader and scan, environment values resolved leniently
 * and refused when read, providers as stubs, settings as defaults, no
 * bootstrap, no listener. `tulipes routes` and `tulipes spec` run it.
 */
const acl = `export default acl => { acl.defineRole('guest').allow('guest', 'probe:web:read'); };`;

const declaration = `
  import { Router } from 'express';
  import { z } from 'zod/v4';
  export default ({ rai }) => {
    const router = Router();
    router.get('/probe/:id', rai({ id: 'probe:web:read', params: z.object({ id: z.string() }), returns: z.object({ id: z.string() }) }),
      (req, res) => res.respond({ data: { id: req.params.id } }));
    return router;
  };
`;

const documents = async (ctx: Pick<Ctx, "config" | "routes" | "acl">) => {
  const source = { ...extract(ctx), app: { name: "parity" } };
  return { openapi: await toOpenApi(source), postman: await toPostman(source) };
};

test("inspection mounts every route without resolving a variable, importing a provider or opening a connection", async () => {
  const files: Record<string, string> = {
    "modules/probe/routes/probe.routes.js": `
      import { Router } from 'express';
      import { RuntimeController } from '../controllers/runtime.js';
      export default (ctx) => {
        const router = Router();
        const controller = new RuntimeController(ctx);
        router.get('/probe/:id', ctx.rai({ id: 'probe:web:read' }), controller.show());
        return router;
      };`,
    "modules/probe/controllers/runtime.js": `
      export class RuntimeController {
        constructor(ctx) { this.ctx = ctx; }
        show() { return (req, res) => res.respond({ data: { key: this.ctx.config.probe.privateKey, id: this.ctx.models.get('Thing') } }); }
      }`,
    "modules/probe/module.acl.js": acl,
    "modules/probe/package.json": JSON.stringify({ name: "@test/probe", type: "module", tulipes: { requires: ["models"], env: {
      privateKey: { key: "PRIVATE_KEY", type: "secret", required: true, description: "Runtime only" },
      mongoUri: { key: "MONGO_URI", type: "url", required: true, description: "Runtime database" },
    } } }),
    ".envs/.env.production": "MONGO_URI=invalid\n",
    "package.json": JSON.stringify({ type: "module", tulipes: { providers: { models: "./providers/models.js", queues: "./providers/queues.js", sockets: "./providers/sockets.js" } } }),
  };
  for (const path of ["providers/models.js", "providers/queues.js", "providers/sockets.js", "modules/probe/bootstrap/runtime.bootstrap.js", "modules/probe/queues/runtime.queues.js", "modules/probe/sockets/runtime.sockets.js"]) {
    files[path] = `throw new Error('runtime file imported: ${path}');`;
  }
  const app = await fixture(files);

  vi.stubEnv("APP_ENV", "production");
  vi.stubEnv("PRIVATE_KEY", undefined);
  const connect = vi.spyOn(Socket.prototype, "connect").mockImplementation(() => { throw new Error("network forbidden"); });

  const inspected = await app.boot({ inspect: true });
  expect(extract(inspected.ctx).routes[0]).toMatchObject({ path: "/probe/:id", roles: ["guest"], public: true });
  expect(inspected.server!.listening).toBe(false);
  expect(inspected.providers.map((status) => status.skipped)).toEqual(["inspect", "inspect", "inspect"]);
  expect(() => inspected.ctx.config.probe!.privateKey).toThrow(/config\.probe\.privateKey is an environment value, not available during inspection — read it inside a handler/);
  // Leniently resolved: the invalid URL is absent rather than an error, and nothing is required.
  expect(inspected.ctx.settings.describeEnv("probe").map((variable) => [variable.name, variable.isSet])).toEqual([["privateKey", false], ["mongoUri", false]]);
  expect(connect).not.toHaveBeenCalled();
  await inspected.shutdown();

  // The same app, booted for real, resolves its environment and refuses the missing secret.
  await expect(app.boot()).rejects.toThrow(/PRIVATE_KEY/);
});

test("routes files are read from scope folders too, in path order, attributed to their module", async () => {
  const routesFile = (id: string, path: string) => `
    import { Router } from 'express';
    export default ({ rai }) => {
      const router = Router();
      router.get('${path}', rai({ id: '${id}' }), (req, res) => res.respond({ data: '${id}' }));
      return router;
    };`;
  const app = await fixture({
    "modules/probe/module.acl.js": `export default acl => acl.defineRole('guest').allow('guest', 'probe:*');`,
    "modules/probe/routes/bo.probe.routes.js": routesFile("probe:bo:list", "/bo/probe"),
    "modules/probe/routes/web/probe.routes.js": routesFile("probe:web:list", "/probe"),
    "modules/probe/routes/web/probe.items.routes.js": routesFile("probe:web:items", "/probe/items"),
    // Not a routes file: the suffix is what the explorer reads, at any depth.
    "modules/probe/routes/web/notes.md": "a scope folder may hold anything else",
  });

  const inspected = await app.boot({ inspect: true });

  expect(inspected.ctx.routes.all().map(({ info, module }) => [info.id, module])).toEqual([
    ["probe:bo:list", "probe"],
    ["probe:web:items", "probe"],
    ["probe:web:list", "probe"],
  ]);

  await inspected.shutdown();
});

test("a routes file that touches infrastructure while building fails inspection with its path", async () => {
  for (const [body, message] of [
    ["ctx.config.probe.secret", /config\.probe\.secret is an environment value, not available during inspection/],
    ["ctx.models.get('Thing')", /ctx\.models is not available during inspection/],
  ] as const) {
    const app = await fixture({
      "package.json": JSON.stringify({ type: "module", tulipes: { providers: { models: "./providers/models.js" } } }),
      "providers/models.js": `throw new Error('provider imported');`,
      "modules/probe/package.json": JSON.stringify({ name: "@test/probe", type: "module", tulipes: { requires: ["models"], env: { secret: { key: "PROBE_SECRET", type: "secret", description: "Runtime only" } } } }),
      "modules/probe/routes/probe.routes.js": `export default (ctx) => { ${body}; };`,
    });
    const error = await app.boot({ inspect: true }).catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(message);
    expect((error as Error).message).toMatch(/\[probe\] routes function threw/);
  }
});

test("the inspection and the running app describe the same routes, schemas and authorization", async () => {
  const app = await fixture({
    "modules/probe/routes/probe.routes.js": declaration,
    "modules/probe/module.acl.js": acl,
  });

  const inspected = await app.boot({ inspect: true });
  const handle = await app.boot();

  expect(await documents(handle.ctx)).toEqual(await documents(inspected.ctx));

  const response = await fetch(url(handle) + "/probe/123");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ data: { id: "123" } });

  const denied = await fixture({
    "modules/probe/routes/probe.routes.js": declaration,
    "modules/probe/module.acl.js": "export default acl => { acl.defineRole('guest'); };",
  });
  const privateApp = await denied.boot();
  expect((await fetch(url(privateApp) + "/probe/123")).status).toBe(401);
});

test("a returned router lands under the configured prefix; mount() chooses another path or nests", async () => {
  const app = await fixture({
    "config/app.config.js": `export default () => ({ api: { prefix: '/api/v2' } });`,
    "modules/probe/module.acl.js": `export default acl => acl.defineRole('guest').allow('guest', 'probe:web:read', 'probe:web:nested', 'probe:web:ops');`,
    "modules/probe/routes/probe.routes.js": `
      import { Router } from 'express';
      export default ({ rai, routes }) => {
        const router = Router();
        router.get('/items', rai({ id: 'probe:web:read' }), (_req, res) => res.respond({ data: 'prefixed' }));
        const tenants = Router({ mergeParams: true });
        tenants.get('/users/:id', rai({ id: 'probe:web:nested' }), (req, res) => res.respond({ data: req.params }));
        routes.mount(router, '/tenants/:tenant', tenants);
        const ops = Router();
        ops.get('/health', rai({ id: 'probe:web:ops' }), (_req, res) => res.respond({ data: 'ok' }));
        routes.mount(ops, '/ops');
        return router;
      };`,
  });

  const inspected = await app.boot({ inspect: true });
  expect(inspected.ctx.routes.all().map((record) => record.path).sort()).toEqual([
    "/api/v2/items",
    "/api/v2/tenants/:tenant/users/:id",
    "/ops/health",
  ]);
  await inspected.shutdown();

  const handle = await app.boot();
  expect(await (await fetch(url(handle) + "/api/v2/tenants/acme/users/7")).json()).toMatchObject({ data: { tenant: "acme", id: "7" } });
  expect(await (await fetch(url(handle) + "/ops/health")).json()).toMatchObject({ data: "ok" });
});

test.each([
  [`export default {};`, /must default-export a routes function/],
  [`export default () => 42;`, /returns a Router or nothing/],
  [declaration.replace("router.get", "router.all"), /all.*unsupported/],
  [declaration.replace("'/probe/:id'", "'/probe/*rest'"), /unsupported route path/],
  [declaration.replace("id: 'probe:web:read',", "id: 'probe:web:read', status: 500,"), /success status/],
  [declaration.replace("id: 'probe:web:read',", "id: '',"), /rai id "" is invalid/],
  // The 0.11 shape: two segments, no scope.
  [declaration.replace("id: 'probe:web:read',", "id: 'probe:read',"), /rai id "probe:read" has no scope — since 0\.12 an id is "module:scope:resource\[:extra\]" \(`tulipes migrate 0\.12` rewrites a 0\.11 app\)/],
  [declaration.replace("id: 'probe:web:read',", "id: 'Probe:web:read',"), /rai id "Probe:web:read" is invalid/],
  [declaration.replace("id: 'probe:web:read',", "id: 'probe:web:detail:delete:now',"), /is invalid/],
])("rejects malformed routes files under inspection: %s", async (source, message) => {
  const app = await fixture({ "modules/probe/routes/probe.routes.js": source });
  await expect(app.boot({ inspect: true })).rejects.toThrow(message);
});

test.each(["duplicate id", "duplicate path"])("the scan rejects a %s across modules", async (kind) => {
  const app = await fixture({
    "modules/probe/routes/probe.routes.js": declaration,
    "modules/other/package.json": '{"name":"@test/other","type":"module"}',
    "modules/other/routes/other.routes.js":
      kind === "duplicate id"
        ? declaration
        : declaration.replace("'probe:web:read'", "'other:web:read'").replace("'/probe/:id'", "'/probe/:other'"),
  });
  await expect(app.boot({ inspect: true })).rejects.toThrow(/already declared/);
});

test.each(["invalid", "legacy", "duplicate"] as const)("inspection checks %s environment declarations without requiring values", async (kind) => {
  const declarations: Record<typeof kind, unknown> = {
    invalid: { bad: { type: "number" } },
    legacy: [{ name: "PORT", type: "number", description: "0.11 shape" }],
    duplicate: { first: { key: "PORT", type: "number", description: "First" }, second: { key: "PORT", type: "number", description: "Second" } },
  };
  const app = await fixture({
    "modules/probe/package.json": JSON.stringify({ name: "@test/probe", type: "module", tulipes: { env: declarations[kind] } }),
  });
  const message: Record<typeof kind, RegExp> = { invalid: /tulipes" key: env\.bad\.key — Required/, legacy: /tulipes\.env is an object keyed by config name since 0\.12/, duplicate: /already supplies "first"/ };
  await expect(app.boot({ inspect: true })).rejects.toThrow(message[kind]);
});

test("a variable has one owning module across the app", async () => {
  const app = await fixture({
    "modules/probe/package.json": JSON.stringify({ name: "@test/probe", type: "module", tulipes: { env: { port: { key: "PORT", type: "number", description: "Probe's" } } } }),
    "modules/other/package.json": JSON.stringify({ name: "@test/other", type: "module", tulipes: { env: { listen: { key: "PORT", type: "number", description: "Other's" } } } }),
  });
  await expect(app.boot({ inspect: true })).rejects.toThrow(/variable "PORT" is already declared by module "(probe|other)" — one owner per variable/);
});

test("the 0.10 forms are refused by name: tulipes.offline, defineRoutes and the legacy declaration file", async () => {
  const offline = await fixture({
    "modules/probe/package.json": '{"name":"@test/probe","type":"module","tulipes":{"offline":true}}',
  });
  await expect(offline.boot({ inspect: true })).rejects.toThrow(/tulipes\.offline" is gone — every module is inspectable/);

  const legacy = await fixture({ "modules/probe/meta.variables.json": '{"variables":[]}' });
  await expect(legacy.boot({ inspect: true })).rejects.toThrow(/meta\.variables\.json does not belong at the module root — its variables moved to package\.json under "tulipes": \{ "env"/);
  await expect(legacy.boot({ mode: "script" })).rejects.toThrow(/meta\.variables\.json does not belong/);

  const root = await fixture({ "modules/probe/index.js": "export const x = 1;", "modules/probe/schemas.js": "export const y = 1;" });
  await expect(root.boot({ mode: "script" })).rejects.toThrow(/index\.js does not belong at the module root — its public exports live in lib\/index\.js[\s\S]*schemas\.js does not belong at the module root/);
});

test("inspection preserves ACL and module graph validation", async () => {
  const app = await fixture({ "modules/probe/module.acl.js": `export default acl => { acl.allow('unknown', 'probe:web:read'); };` });
  await expect(app.boot({ inspect: true })).rejects.toThrow(/unknown/);

  const broken = await fixture({
    "modules/probe/package.json": '{"name":"@test/probe","type":"module","tulipes":{"dependsOn":["missing"]}}',
    "modules/probe/routes/probe.routes.js": "throw new Error('imported too early');",
  });
  await expect(broken.boot({ inspect: true })).rejects.toThrow(/missing/);
});

test("dependsOn is derived from a module's scoped dependencies", async () => {
  const app = await fixture({
    "modules/probe/package.json": JSON.stringify({ name: "@test/probe", type: "module", dependencies: { "@test/base": "workspace:*", express: "^5" } }),
    "modules/base/package.json": '{"name":"@test/base","type":"module"}',
  });
  const handle = await app.boot({ mode: "script" });
  expect(handle.ctx.modules.map((module) => module.name)).toEqual(["base", "probe"]);
  expect(handle.ctx.modules.find((module) => module.name === "probe")!.dependsOn).toEqual(["base"]);
  await handle.shutdown();

  const cycle = await fixture({
    "modules/probe/package.json": JSON.stringify({ name: "@test/probe", type: "module", dependencies: { "@test/base": "workspace:*" } }),
    "modules/base/package.json": JSON.stringify({ name: "@test/base", type: "module", dependencies: { "@test/probe": "workspace:*" } }),
  });
  await expect(cycle.boot({ mode: "script" })).rejects.toThrow(/dependency cycle/);
});

test("a custom access checker installed while building stays dynamic under inspection and enforces policy at runtime", async () => {
  const app = await fixture({
    "modules/probe/routes/probe.routes.js": `
      export default ({ app, rai, routes }) => {
        routes.setAccessChecker(async () => false);
        app.get('/p', rai({ id: 'probe:web:read' }), () => { throw new Error('denied handler ran'); });
      };`,
    "modules/probe/module.acl.js": acl,
  });

  const inspected = await app.boot({ inspect: true });
  expect(extract(inspected.ctx).routes[0]).toMatchObject({ authorization: "dynamic", roles: [], public: false });

  const handle = await app.boot();
  expect((await fetch(url(handle) + "/p")).status).toBe(401);
  expect(await documents(handle.ctx)).toEqual(await documents(inspected.ctx));
});

test("the reference app inspects deterministically with connections denied and no secrets", async () => {
  vi.stubEnv("APP_ENV", "production");
  for (const name of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "AUTH_ADMIN_PASSWORD", "MONGO_URI", "REDIS_URL"]) vi.stubEnv(name, undefined);
  const connect = vi.spyOn(Socket.prototype, "connect").mockImplementation(() => { throw new Error("network forbidden"); });

  const { boot } = await import("../src/boot/boot.ts");
  const inspect = () => boot({ rootDir: resolve("example"), mode: "backend", inspect: true, handleSignals: false });

  const first = await inspect();
  expect(first.ctx.routes.all()).toHaveLength(30);
  const documentsFirst = await documents(first.ctx);
  await first.shutdown();

  const second = await inspect();
  expect(await documents(second.ctx)).toEqual(documentsFirst);
  await second.shutdown();

  expect(documentsFirst.openapi.warnings).toEqual([]);
  expect(documentsFirst.postman.warnings).toEqual([]);
  expect(connect).not.toHaveBeenCalled();
});

const cli = resolve("packages/cli/src/bin.ts");

test.each([
  ["routes", "--offline"],
  ["routes", "--runtime"],
  ["routes", "--ofline"],
  ["spec", "--offline", "--openapi", "x.json"],
  ["spec", "--unknown"],
  ["spec", "--url", "one", "--url", "two"],
])("CLI rejects removed or invalid inspection arguments: %j", async (...args) => {
  const app = await fixture();
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: app.rootDir, encoding: "utf8" });
  expect(result.status, result.stdout + result.stderr).toBe(2);
  expect(result.stderr).toMatch(/option|requires|removed in 0\.11/);
});

test("CLI writes specs for a freshly generated production app without services", async () => {
  const app = await fixture();

  const run = (cwd: string, args: string[]) => {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd,
      encoding: "utf8",
      timeout: 20_000,
      env: { ...process.env, APP_ENV: "production", JWT_ACCESS_SECRET: "", JWT_REFRESH_SECRET: "", MONGO_URI: "invalid", REDIS_URL: "invalid" },
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    return result.stdout;
  };

  run(app.rootDir, ["init", "generated", "--preset", "production"]);
  const root = app.rootDir + "/generated";

  expect(run(root, ["routes"])).toContain("30 endpoint(s)");
  run(root, ["spec", "--openapi", "docs/openapi.json", "--postman", "docs/collection.json"]);
  const { readFile } = await import("node:fs/promises");
  const openapi = JSON.parse(await readFile(root + "/docs/openapi.json", "utf8"));
  expect(Object.keys(openapi.paths)).toContain("/api/v1/auth/login");
  expect(openapi.paths["/api/v1/auth/login"].post).toMatchObject({ operationId: "auth:web:login", "x-tulipes-scope": "web", "x-tulipes-roles": ["admin", "guest", "sysadmin"] });
  expect(openapi["x-tulipes-roles"].map((role: { name: string }) => role.name)).toEqual(["guest", "user", "admin", "sysadmin"]);

  // One surface: the back office alone.
  expect(run(root, ["routes", "--scope", "bo"])).toContain('7 endpoint(s) in scope "bo"');
  run(root, ["spec", "--openapi", "docs/bo.json", "--scope", "bo"]);
  const backOffice = JSON.parse(await readFile(root + "/docs/bo.json", "utf8"));
  expect(backOffice["x-tulipes-scopes"]).toEqual(["bo"]);
  expect(Object.keys(backOffice.paths)).not.toContain("/api/v1/auth/login");
  expect(Object.keys(backOffice.paths)).toContain("/users/deleted");

  expect(run(root, ["roles", "--role", "admin"])).toMatch(/admin\s+Runs the back office\s+\(auth\)\n\s+level=2\n/);
});
