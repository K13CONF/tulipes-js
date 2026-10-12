import { expect, test } from "vitest";
import { extract } from "../src/extract.ts";
import { toOpenApi } from "../src/openapi.ts";
import { fixture } from "../../core/tests/fixture.ts";

test("extracts mounted paths, statuses and custom authorization from the inspected app", async () => {
  const app = await fixture({
    "modules/probe/routes/probe.routes.js": `
      import { Router } from 'express';
      export default ctx => {
        const child = Router();
        child.post('/items', ctx.rai({ id: 'probe:web:create', status: 201 }), (req, res) => res.respond({ data: {} }));
        ctx.routes.mount(ctx.app, '/catalog', child);
        ctx.routes.setAccessChecker(() => true);
      };
    `,
  });

  const handle = await app.boot({ inspect: true });

  expect(extract(handle.ctx).routes).toEqual([
    expect.objectContaining({
      path: "/catalog/items",
      method: "POST",
      status: 201,
      authorization: "dynamic",
      roles: [],
      public: false,
    }),
  ]);
});

test("each route carries its scope, the source lists scopes and roles, and a scope narrows it", async () => {
  const app = await fixture({
    "modules/probe/module.acl.js": `export default acl => acl
      .defineRole('guest', { description: 'Anyone' })
      .defineRole('admin', { description: 'Runs the back office', level: 2 })
      .allow('guest', 'probe:web:list')
      .allow('admin', 'probe:*');`,
    "modules/probe/routes/probe.routes.js": `
      import { Router } from 'express';
      export default ({ rai }) => {
        const router = Router();
        router.get('/probe', rai({ id: 'probe:web:list' }), (req, res) => res.respond({ data: [] }));
        router.get('/bo/probe', rai({ id: 'probe:bo:list' }), (req, res) => res.respond({ data: [] }));
        router.delete('/bo/probe/:id', rai({ id: 'probe:bo:detail:delete' }), (req, res) => res.respond({ data: null }));
        return router;
      };
    `,
  });

  const handle = await app.boot({ inspect: true });
  const everything = extract(handle.ctx);
  const backOffice = extract(handle.ctx, { scope: "bo" });

  expect(everything.scopes).toEqual(["bo", "web"]);
  expect(everything.roles).toEqual([
    { name: "guest", description: "Anyone", extras: {} },
    { name: "admin", description: "Runs the back office", extras: { level: 2 } },
  ]);
  expect(everything.routes.map(({ id, scope, roles }) => [id, scope, roles])).toEqual([
    ["probe:bo:list", "bo", ["admin"]],
    ["probe:bo:detail:delete", "bo", ["admin"]],
    ["probe:web:list", "web", ["admin", "guest"]],
  ]);

  expect(backOffice.routes.map(({ id }) => id)).toEqual(["probe:bo:list", "probe:bo:detail:delete"]);
  expect(backOffice.scopes).toEqual(["bo"]);
  expect(extract(handle.ctx, { scope: "mobile" }).routes).toEqual([]);

  const { document } = await toOpenApi(backOffice);

  expect(document).toMatchObject({
    "x-tulipes-scopes": ["bo"],
    "x-tulipes-roles": [
      { name: "guest", description: "Anyone" },
      { name: "admin", description: "Runs the back office", level: 2 },
    ],
    paths: {
      "/bo/probe": { get: { "x-tulipes-permission": "probe:bo:list", "x-tulipes-scope": "bo", "x-tulipes-roles": ["admin"] } },
    },
  });

  await handle.shutdown();
});
