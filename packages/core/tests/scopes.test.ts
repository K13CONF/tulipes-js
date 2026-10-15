import { expect, test } from "vitest";
import { scopesCover } from "../src/acl/index.ts";
import { fixture, url } from "./fixture.ts";

/**
 * Credential scopes (0.13-S01): a credential limited to grant patterns
 * reaches what its role grants AND its scopes cover — over a route and over
 * an action alike — and the manifest shows a scoped caller only those tools.
 */

test("scopes cover in the grant grammar, and never narrow an unscoped credential", () => {
  expect(scopesCover(undefined, "users:bo:list")).toBe(true);
  expect(scopesCover(["*"], "users:bo:list")).toBe(true);
  expect(scopesCover(["users:*"], "users:bo:list")).toBe(true);
  expect(scopesCover(["users:bo:*"], "users:bo:list")).toBe(true);
  expect(scopesCover(["users:bo:list"], "users:bo:list")).toBe(true);
  expect(scopesCover(["users:bo:detail:*"], "users:bo:detail:delete")).toBe(true);
  expect(scopesCover(["users:web:*"], "users:bo:list")).toBe(false);
  expect(scopesCover(["users:bo:list"], "users:bo:list:all")).toBe(false);
  expect(scopesCover([], "users:bo:list")).toBe(false);
});

const acl = `export default acl => acl.defineRole('guest').defineRole('user').defineRole('admin')
  .allow('user', 'probe:web:*', 'agent:*').allow('admin', 'probe:*', 'agent:*');`;

// A test identity the way an auth module would set one: ?as=<role>&scopes=a,b (scopes= empty is [])
const routes = `
  import express, { Router } from 'express';
  import { z } from 'zod/v4';
  import { roleOf } from '@tulipes/core/http';
  export default ctx => {
    const r = Router();
    r.use(express.json());
    r.use((req, res, next) => {
      if (req.query.as) req.auth = { isAuthenticated: true, user: { role: String(req.query.as) }, session: null,
        ...(req.query.scopes !== undefined && { scopes: String(req.query.scopes).split(',').filter(Boolean) }) };
      next();
    });
    r.get('/things', ctx.rai({ id: 'probe:web:read' }), (req, res) => res.respond({ data: [] }));
    r.get('/admin/things', ctx.rai({ id: 'probe:bo:read' }), (req, res) => res.respond({ data: [] }));
    r.get('/tools', ctx.rai({ id: 'agent:web:tools' }), (req, res) =>
      res.respond({ data: ctx.agent.manifest({ ...req.auth, role: roleOf(req) }).tools.map(tool => tool.name) }));
    r.post('/agent/:name', ctx.rai({ id: 'agent:web:invoke' }), async (req, res) =>
      res.respond({ data: await ctx.agent.invoke(req.params.name, req.body, { ...req.auth, role: roleOf(req) }, req) }));
    return r;
  };
`;

const agent = `
  import { action, defineAgent } from '@tulipes/core/agent';
  export default defineAgent({ actions: [
    action({ id: 'probe:web:count', description: 'Count', readOnly: true, handler: () => 1 }),
    action({ id: 'probe:bo:purge', description: 'Purge', handler: () => 'purged' }),
  ] });
`;

async function boot(extraRoutes = routes) {
  const app = await fixture({
    "modules/probe/module.acl.js": acl,
    "modules/probe/routes/probe.routes.js": extraRoutes,
    "modules/probe/agent/probe.agent.js": agent,
  });
  const handle = await app.boot();
  const call = async (method: string, path: string) => {
    const response = await fetch(`${url(handle)}${path}`, { method, headers: { "content-type": "application/json", connection: "close" }, body: method === "POST" ? "{}" : undefined });
    const body = await response.json() as { data: unknown; errors: { code: string }[] };
    return { status: response.status, data: body.data, code: body.errors[0]?.code };
  };
  return { handle, call };
}

test("a scoped credential reaches routes its role grants and its scopes cover, and is told OUT_OF_SCOPE otherwise", async () => {
  const { handle, call } = await boot();
  try {
    // Unscoped: the role's full grant, exactly as before scopes existed.
    expect(await call("GET", "/admin/things?as=admin")).toMatchObject({ status: 200 });
    // Scoped to one RAI scope of the module: in reaches, out is refused by scope, not by role.
    expect(await call("GET", "/things?as=admin&scopes=probe:web:*,agent:*")).toMatchObject({ status: 200 });
    expect(await call("GET", "/admin/things?as=admin&scopes=probe:web:*,agent:*")).toMatchObject({ status: 403, code: "OUT_OF_SCOPE" });
    // A scope the role lacks grants nothing: the role decides first.
    expect(await call("GET", "/admin/things?as=user&scopes=probe:*")).toMatchObject({ status: 403, code: "FORBIDDEN" });
    // An empty list reaches nothing.
    expect(await call("GET", "/things?as=admin&scopes=")).toMatchObject({ status: 403, code: "OUT_OF_SCOPE" });
  } finally {
    await handle.shutdown();
  }
});

test("the manifest and invoke() narrow an action by the actor's scopes", async () => {
  const { handle, call } = await boot();
  try {
    expect(await call("GET", "/tools?as=admin")).toMatchObject({ data: ["probe_web_count", "probe_bo_purge"] });
    expect(await call("GET", "/tools?as=admin&scopes=probe:web:*,agent:*")).toMatchObject({ data: ["probe_web_count"] });
    expect(await call("POST", "/agent/probe_web_count?as=admin&scopes=probe:web:*,agent:*")).toMatchObject({ status: 200, data: 1 });
    expect(await call("POST", "/agent/probe_bo_purge?as=admin&scopes=probe:web:*,agent:*")).toMatchObject({ status: 403, code: "OUT_OF_SCOPE" });
    expect(await call("POST", "/agent/probe_bo_purge?as=admin")).toMatchObject({ status: 200, data: "purged" });

    // In process, an agent module gets the same answer without HTTP.
    const actor = { isAuthenticated: true, user: null, session: null, role: "admin", scopes: ["probe:web:*"] };
    expect(handle.ctx.agent!.manifest(actor).tools.map((tool) => tool.name)).toEqual(["probe_web_count"]);
    await expect(handle.ctx.agent!.invoke("probe_bo_purge", {}, actor)).rejects.toMatchObject({ status: 403, code: "OUT_OF_SCOPE" });
  } finally {
    await handle.shutdown();
  }
});

test("a custom access checker replaces the whole decision, scopes included", async () => {
  const { handle, call } = await boot(routes.replace("export default ctx => {", "export default ctx => { ctx.routes.setAccessChecker(() => true);"));
  try {
    expect(await call("GET", "/admin/things?as=user&scopes=")).toMatchObject({ status: 200 });
  } finally {
    await handle.shutdown();
  }
});
