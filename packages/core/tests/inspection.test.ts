import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Socket } from "node:net";
import { expect, test, vi } from "vitest";
import { inspectRoutes, type InspectionContext } from "../src/boot/inspect.js";
import { extract } from "../../spec/src/extract.js";
import { toOpenApi } from "../../spec/src/openapi.js";
import { toPostman } from "../../spec/src/postman.js";
import { fixture, url } from "./fixture.js";

const manifest =
  '{"name":"@test/probe","type":"module","tulipes":{"offline":true}}';

const acl = `export default acl => { acl.defineRole('guest').allow('guest', 'probe:read'); };`;
const imports = `import { Router } from 'express'; import { defineRoutes } from '@tulipes/core/http';`;

const declaration = `${imports}
  import { z } from 'zod/v4';
  export default defineRoutes(({rai}) => {
    const router = Router();
    router.get('/probe/:id', rai({ id: 'probe:read', params: z.object({ id: z.string() }), returns: z.object({ id: z.string() }) }),
      (req, res) => res.respond({ data: { id: req.params.id } }));
    return router;
  });
`;

const offlineFixture = (files: Record<string, string> = {}) =>
  fixture({ "modules/probe/package.json": manifest, ...files });

const documents = async (ctx: InspectionContext) => {
  const source = { ...extract(ctx), app: { name: "parity" } };

  return { openapi: await toOpenApi(source), postman: await toPostman(source) };
};

test("offline composes routers without importing runtime dependencies or resolving secrets", async () => {
  const files: Record<string, string> = {
    "modules/probe/routes/probe.routes.js": `${imports}
      export default defineRoutes(({rai,runtime}) => {
        const router = Router();
        const controller = runtime(async () => { await import('../controllers/runtime.js'); throw new Error('acquired'); });
        router.get('/probe/:id', rai({id:'probe:read'}), controller(value => value.handler));
        return router;
      });`,
    "modules/probe/module.acl.js": acl,
    "modules/probe/meta.variables.json": JSON.stringify({
      variables: [
        {
          name: "PRIVATE_KEY",
          type: "secret",
          required: true,
          description: "Runtime only",
        },
        {
          name: "MONGO_URI",
          type: "url",
          required: true,
          description: "Runtime database",
        },
      ],
    }),
    ".envs/.env.production": "MONGO_URI=invalid\n",
    // Declared, so the module's models/ requirement is met offline; the
    // provider file itself must never be imported by inspection.
    "package.json": JSON.stringify({ type: "module", tulipes: { providers: { models: "./providers/models.js", queues: "./providers/queues.js", sockets: "./providers/sockets.js" } } }),
  };

  for (const path of [
    "providers/models.js",
    "providers/queues.js",
    "providers/sockets.js",
    "config/app.config.js",
    "modules/probe/module.config.js",
    "modules/probe/controllers/runtime.js",
    "modules/probe/models/runtime.model.js",
    "modules/probe/bootstrap/runtime.bootstrap.js",
    "modules/probe/queues/runtime.queues.js",
    "modules/probe/sockets/runtime.sockets.js",
  ])
    files[path] = `throw new Error('runtime file imported: ${path}');`;

  const app = await offlineFixture(files);

  vi.stubEnv("APP_ENV", "production");
  vi.stubEnv("PRIVATE_KEY", undefined);

  const connect = vi
    .spyOn(Socket.prototype, "connect")
    .mockImplementation(() => {
      throw new Error("network forbidden");
    });

  const context = await inspectRoutes(app);

  expect(extract(context).routes[0]).toMatchObject({
    path: "/probe/:id",
    roles: ["guest"],
    public: true,
  });

  expect(connect).not.toHaveBeenCalled();

  await expect(app.boot()).rejects.toThrow(/PRIVATE_KEY/);
});

test("native routes share schemas and enforce authorization at runtime", async () => {
  const app = await offlineFixture({
    "modules/probe/routes/probe.routes.js": declaration,
    "modules/probe/module.acl.js": acl,
  });

  const handle = await app.boot();

  expect(await documents(handle.ctx)).toEqual(
    await documents(await inspectRoutes(app)),
  );

  const response = await fetch(url(handle) + "/probe/123");

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ data: { id: "123" } });

  const denied = await offlineFixture({
    "modules/probe/routes/probe.routes.js": declaration,
    "modules/probe/module.acl.js":
      "export default acl => { acl.defineRole('guest'); };",
  });

  const privateApp = await denied.boot();

  expect((await fetch(url(privateApp) + "/probe/123")).status).toBe(401);
});

test("shared prefixes, middleware and router.param retain scope, order and one acquisition per boot", async () => {
  const app = await offlineFixture({
    "modules/probe/module.acl.js": acl,
    "modules/probe/routes/probe.routes.js": `${imports}
    export default defineRoutes(({app,rai,routes,runtime}) => {
      const parent = Router();
      const users = Router({mergeParams:true});
      let acquisitions = 0, parameters = 0;
      const callbacks = runtime(() => {
        acquisitions++;
        return {
          middleware: (_req,res,next) => { res.locals.order = ['middleware']; next(); },
          param: (req,res,next,id,name) => { parameters++; res.locals.order.push('param'); res.locals.loaded={id,name}; next(); },
          show: (req,res) => { res.locals.order.push(req.rai.id); res.respond({data:{...res.locals, tenant:req.params.tenant, acquisitions, parameters}}); },
        };
      });
      users.use(callbacks(value=>value.middleware));
      users.param('id', callbacks(value=>value.param));
      users.route('/:id').get(rai({id:'probe:read'}),callbacks(value=>value.show));
      routes.mount(parent, '/tenants/:tenant/users', users);
      routes.mount(app, '/api/v1', parent);
      app.get('/outside',rai({id:'probe:outside'}),(_req,res)=>res.respond({data:res.locals}));
    });`,
  });

  const offline = await inspectRoutes(app);

  expect(offline.routes.all().map((record) => record.path)).toContain(
    "/api/v1/tenants/:tenant/users/:id",
  );

  const handle = await app.boot();

  expect(await documents(handle.ctx)).toEqual(await documents(offline));

  for (const [index, id] of ["1", "2"].entries()) {
    const response = await fetch(
      url(handle) + "/api/v1/tenants/acme/users/" + id,
    );

    expect(response.status).toBe(200);

    expect(await response.json()).toMatchObject({
      data: {
        order: ["middleware", "param", "probe:read"],
        loaded: { id, name: "id" },
        tenant: "acme",
        acquisitions: 1,
        parameters: index + 1,
      },
    });
  }

  expect((await fetch(url(handle) + "/outside")).status).toBe(401);

  // A second boot must own different bindings, even with Node's import cache.
  const second = await app.boot();

  expect(
    await (await fetch(url(second) + "/api/v1/tenants/other/users/3")).json(),
  ).toMatchObject({
    data: { acquisitions: 1, parameters: 1, tenant: "other" },
  });
});

test("bound callbacks preserve async rejection, next('route'), and Express error-handler arity", async () => {
  const app = await offlineFixture({
    "modules/probe/module.acl.js": `export default acl => {acl.defineRole('guest').allow('guest','probe:*');};`,
    "modules/probe/routes/probe.routes.js": `${imports}
    export default defineRoutes(({rai,runtime})=>{
      const router=Router();
      const handlers=runtime(()=>({
        skip: (_req,_res,next)=>next('route'),
        fail: async ()=>{throw new Error('expected');},
        error: (err,_req,res,_next)=>res.respond({data:{caught:err.message}}),
      }));
      router.get('/item/:id',rai({id:'probe:first'}),handlers(value=>value.skip),()=>{throw new Error('should skip');});
      router.get('/item/fallback',rai({id:'probe:fallback'}),(_req,res)=>res.respond({data:{fallback:true}}));
      router.get('/failure',rai({id:'probe:failure'}),handlers(value=>value.fail));
      router.use(handlers(value=>value.error));
      return router;
    });`,
  });

  const handle = await app.boot();

  expect(
    await (await fetch(url(handle) + "/item/fallback")).json(),
  ).toMatchObject({ data: { fallback: true } });

  expect(await (await fetch(url(handle) + "/failure")).json()).toMatchObject({
    data: { caught: "expected" },
  });
});

test("legacy modules fail offline before importing route files and keep runtime inspection", async () => {
  const app = await fixture({
    "modules/probe/routes/probe.routes.js": `export default () => {};`,
  });

  await expect(inspectRoutes(app)).rejects.toThrow(
    /probe.*tulipes.offline.*--runtime/,
  );

  const handle = await app.boot({ inspect: true });

  expect(handle.ctx.routes.all()).toEqual([]);
});

test.each([
  [`export default {};`, /defineRoutes/],
  [`export default () => {};`, /defineRoutes/],
  [`${imports} export default defineRoutes(()=>42);`, /Router or void/],
  [declaration.replace("router.get", "router.all"), /all.*unsupported/],
  [
    declaration.replace("'/probe/:id'", "'/probe/*rest'"),
    /unsupported route path/,
  ],
  [
    declaration.replace("id: 'probe:read',", "id: 'probe:read', status: 500,"),
    /success status/,
  ],
  [declaration.replace("id: 'probe:read',", "id: '',"), /nonempty string/],
])("rejects malformed router factories: %s", async (source, message) => {
  const app = await offlineFixture({
    "modules/probe/routes/probe.routes.js": source,
  });

  await expect(inspectRoutes(app)).rejects.toThrow(message);
});

test.each(["duplicate id", "duplicate path"])(
  "offline scan rejects %s across modules",
  async (kind) => {
    const app = await offlineFixture({
      "modules/probe/routes/probe.routes.js": declaration,
      "modules/other/package.json": manifest.replace("probe", "other"),
      "modules/other/routes/other.routes.js":
        kind === "duplicate id"
          ? declaration
          : declaration
              .replace("'probe:read'", "'other:read'")
              .replace("'/probe/:id'", "'/probe/:other'"),
    });

    await expect(inspectRoutes(app)).rejects.toThrow(/already declared/);
  },
);

test.each(["invalid", "duplicate"])(
  "offline checks %s environment declarations without resolving values",
  async (kind) => {
    const app = await offlineFixture({
      "modules/probe/meta.variables.json":
        kind === "invalid"
          ? '{"variables":[{"name":"bad"}]}'
          : JSON.stringify({
              variables: [
                { name: "PORT", type: "number", description: "First" },
                { name: "PORT", type: "number", description: "Second" },
              ],
            }),
    });

    await expect(inspectRoutes(app)).rejects.toThrow(
      kind === "invalid" ? /meta.variables/ : /one owner/,
    );
  },
);

test("offline preserves ACL and module graph validation", async () => {
  const app = await offlineFixture({
    "modules/probe/module.acl.js": `export default acl => { acl.allow('unknown', 'probe:read'); };`,
  });

  await expect(inspectRoutes(app)).rejects.toThrow(/unknown/);

  const broken = await offlineFixture({
    "modules/probe/package.json":
      '{"name":"@test/probe","type":"module","tulipes":{"dependsOn":["missing"],"offline":true}}',
    "modules/probe/routes/probe.routes.js":
      "throw new Error('imported too early');",
  });

  await expect(inspectRoutes(broken)).rejects.toThrow(/missing/);
});

test("runtime bindings cannot secretly add endpoints or replace the access checker", async () => {
  for (const mutation of [
    "app.get('/extra',rai({id:'extra'}),()=>{})",
    "routes.setAccessChecker(()=>true)",
  ]) {
    const app = await offlineFixture({
      "modules/probe/routes/probe.routes.js": `${imports}
      export default defineRoutes(({app,rai,routes,runtime})=>{
        const bound=runtime(()=>{${mutation};return ()=>{};});
        app.get('/p',rai({id:'p'}),bound(fn=>fn));
      });`,
    });

    await expect(app.boot({ inspect: true })).rejects.toThrow(
      /runtime\(\) changed/,
    );
  }
});

test.each([
  "undefined",
  "[]",
  "Promise.reject(new Error('acquisition failed'))",
])("runtime rejects broken callback acquisition: %s", async (result) => {
  const app = await offlineFixture({
    "modules/probe/routes/probe.routes.js": `${imports}
    export default defineRoutes(({app,rai,runtime})=>{const bound=runtime(()=>${result});app.get('/p',rai({id:'p'}),bound(value=>value));});`,
  });

  await expect(app.boot({ inspect: true })).rejects.toThrow(
    /must select a callback|acquisition failed/,
  );
});

test("a bound custom access checker stays dynamic offline and enforces policy at runtime", async () => {
  const app = await offlineFixture({
    "modules/probe/routes/probe.routes.js": `${imports}
    export default defineRoutes(({app,rai,routes,runtime})=>{
      const policy=runtime(()=>({check:async()=>false}));
      routes.setAccessChecker(policy(value=>value.check));
      app.get('/p',rai({id:'probe:read'}),()=>{throw new Error('denied handler ran');});
    });`,
    "modules/probe/module.acl.js": acl,
  });

  const context = await inspectRoutes(app);

  expect(extract(context).routes[0]).toMatchObject({
    authorization: "dynamic",
    roles: [],
    public: false,
  });

  const handle = await app.boot();

  expect((await fetch(url(handle) + "/p")).status).toBe(401);
  expect(await documents(handle.ctx)).toEqual(await documents(context));
});

test("production routers generate deterministic documents with connections denied and no secrets", async () => {
  vi.stubEnv("APP_ENV", "production");

  for (const name of [
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "AUTH_ADMIN_PASSWORD",
    "MONGO_URI",
    "REDIS_URL",
  ])
    vi.stubEnv(name, undefined);

  const connect = vi
    .spyOn(Socket.prototype, "connect")
    .mockImplementation(() => {
      throw new Error("network forbidden");
    });

  const context = await inspectRoutes({ rootDir: resolve("example") });

  expect(context.routes.all()).toHaveLength(28);

  const first = await documents(context);

  expect(
    await documents(await inspectRoutes({ rootDir: resolve("example") })),
  ).toEqual(first);

  expect(first.openapi.warnings).toEqual([]);
  expect(first.postman.warnings).toEqual([]);
  expect(connect).not.toHaveBeenCalled();
});

const cli = resolve("packages/cli/src/bin.ts");

test.each([
  ["routes", "--offline", "--runtime"],
  ["routes", "--ofline"],
  ["spec", "--offline", "--openapi"],
  ["spec", "--openapi", "--offline"],
  ["spec", "--unknown"],
  ["spec", "--url", "one", "--url", "two"],
])("CLI rejects invalid inspection arguments: %j", async (...args) => {
  const app = await fixture();

  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", cli, ...args],
    { cwd: app.rootDir, encoding: "utf8" },
  );

  expect(result.status, result.stdout + result.stderr).toBe(2);
  expect(result.stderr).toMatch(/option|requires|Conflicting/);
});

test("CLI writes offline specs for a freshly generated production app", async () => {
  const app = await fixture();

  const run = (cwd: string, args: string[]) => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", cli, ...args],
      {
        cwd,
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          APP_ENV: "production",
          JWT_ACCESS_SECRET: "",
          JWT_REFRESH_SECRET: "",
          MONGO_URI: "invalid",
          REDIS_URL: "invalid",
        },
      },
    );

    expect(result.status, result.stdout + result.stderr).toBe(0);

    return result.stdout;
  };

  run(app.rootDir, ["init", "generated", "--preset", "production"]);

  const root = app.rootDir + "/generated";

  expect(run(root, ["routes", "--offline"])).toContain("28 endpoint(s)");

  run(root, [
    "spec",
    "--offline",
    "--openapi",
    "openapi.json",
    "--postman",
    "postman.json",
    "--url",
    "https://example.test",
  ]);

  const doc = JSON.parse(await readFile(root + "/openapi.json", "utf8"));

  expect(doc.paths["/api/v1/hello"]).toBeDefined();
  expect(doc.servers).toEqual([{ url: "https://example.test" }]);
});
