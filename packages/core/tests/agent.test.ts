import { expect, test } from "vitest";
import { fixture, url } from "./fixture.js";

/**
 * The agent surface: every declared route is a tool unless it opts out, an
 * `agent/` declaration curates exposure and adds actions, the manifest is
 * filtered by role, and a declared action runs through the same gate a
 * route has — ACL, then validation, then the handler.
 */

const acl = `export default acl => acl.defineRole('guest').defineRole('viewer').defineRole('user').defineRole('admin')
  .allow('guest', 'probe:read').allow('viewer', 'agent:*').allow('user', 'probe:*', 'agent:*').allow('admin', 'probe:*', 'agent:*');`;

const routes = `
  import express, { Router } from 'express';
  import { z } from 'zod/v4';
  import { roleOf } from '@tulipes/core/http';
  export default ctx => {
    const r = Router();
    r.use(express.json());
    // A test identity, set before the gate the way an auth module would.
    r.use((req, res, next) => {
      if (req.query.as) req.auth = { isAuthenticated: true, user: { role: String(req.query.as) }, session: null };
      next();
    });
    r.get('/things', ctx.rai({ id: 'probe:read', name: 'List things', description: 'Every thing', query: z.object({ limit: z.coerce.number().int().default(20) }) }), (req, res) => res.respond({ data: [] }));
    r.post('/things/:id', ctx.rai({ id: 'probe:write', name: 'Rename a thing', params: z.object({ id: z.string() }), body: z.object({ name: z.string().min(1) }) }), (req, res) => res.respond({ data: req.body }));
    r.delete('/things/:id', ctx.rai({ id: 'probe:purge', name: 'Purge', agent: false }), (req, res) => res.respond({ data: null }));
    r.post('/agent/:name', ctx.rai({ id: 'agent:invoke', body: z.object({ input: z.unknown().optional() }) }), async (req, res) => {
      res.respond({ data: await ctx.agent.invoke(req.params.name, req.body.input, { ...req.auth, role: roleOf(req) }, req) });
    });
    return r;
  };
`;

const agent = `
  import { action, defineAgent } from '@tulipes/core/agent';
  import { z } from 'zod/v4';
  export default defineAgent({
    summary: 'Keeps things.',
    tools: [
      { route: 'probe:read', description: 'List things, newest first' },
      action({
        id: 'probe:reset',
        description: 'Reset every thing',
        input: z.object({ confirm: z.literal(true), reason: z.string().default('none') }),
        handler: (ctx, input, actor) => ({ reset: true, by: actor.role, reason: input.reason, mode: ctx.mode }),
      }),
      action({ id: 'probe:count', description: 'How many things', readOnly: true, handler: () => 0 }),
    ],
  });
`;

test("without a declaration every route is a tool, except those that opt out", async () => {
  const app = await fixture({
    "modules/probe/module.acl.js": acl,
    "modules/probe/routes/probe.routes.js": routes,
  });
  const handle = await app.boot({ listen: false });
  const manifest = handle.ctx.agent!.manifest();

  expect(manifest.modules).toEqual([{ name: "probe", tools: ["probe_read", "probe_write", "agent_invoke"] }]);
  expect(manifest.authorization).toBe("acl");
  expect(manifest.tools.map((tool) => [tool.name, tool.read_only, tool.transport])).toEqual([
    ["probe_read", true, { kind: "http", method: "GET", path: "/things" }],
    ["probe_write", false, { kind: "http", method: "POST", path: "/things/:id" }],
    ["agent_invoke", false, { kind: "http", method: "POST", path: "/agent/:name" }],
  ]);

  const write = handle.ctx.agent!.find("probe_write")!;
  expect(write.title).toBe("Rename a thing");
  expect(write.description).toBe("Rename a thing");
  expect(write.input_schema).toEqual({
    type: "object",
    properties: {
      params: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
      body: { type: "object", properties: { name: { type: "string", minLength: 1 } }, required: ["name"], additionalProperties: false },
    },
    required: ["params", "body"],
    additionalProperties: false,
  });
  // A query of defaults is optional as a whole.
  expect(handle.ctx.agent!.find("probe_read")!.input_schema).toMatchObject({ required: [] });
  // A path parameter nobody described is still required of the agent.
  expect(handle.ctx.agent!.find("agent_invoke")!.input_schema).toMatchObject({
    properties: { params: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false } },
    required: ["params"], // the body is all-optional, so it is not
  });
  await handle.shutdown();
});

test("a declaration curates the routes, adds actions and the manifest is filtered by role", async () => {
  const app = await fixture({
    "modules/probe/module.acl.js": acl,
    "modules/probe/routes/probe.routes.js": routes,
    "modules/probe/agent/probe.agent.js": agent,
  });
  const handle = await app.boot({ listen: false });
  const registry = handle.ctx.agent!;

  expect(registry.manifest().modules).toEqual([{ name: "probe", summary: "Keeps things.", tools: ["probe_read", "probe_reset", "probe_count"] }]);
  expect(registry.find("probe_read")).toMatchObject({ description: "List things, newest first", title: "List things" });
  expect(registry.find("probe_reset")).toMatchObject({
    transport: { kind: "action" },
    read_only: false,
    input_schema: { type: "object", properties: { confirm: { type: "boolean", const: true }, reason: { type: "string", default: "none" } }, required: ["confirm"], additionalProperties: false },
  });
  expect(registry.find("probe_count")).toMatchObject({ read_only: true, input_schema: { type: "object", properties: {}, additionalProperties: false } });

  expect(registry.manifest("guest").tools.map((tool) => tool.name)).toEqual(["probe_read"]);
  expect(registry.manifest("user").tools.map((tool) => tool.name)).toEqual(["probe_read", "probe_reset", "probe_count"]);
  expect(registry.manifest("nobody")).toMatchObject({ modules: [{ name: "probe", summary: "Keeps things.", tools: [] }], tools: [] });
  await handle.shutdown();
});

test("an action runs through the ACL gate, validation and the envelope", async () => {
  const app = await fixture({
    "modules/probe/module.acl.js": acl,
    "modules/probe/routes/probe.routes.js": routes,
    "modules/probe/agent/probe.agent.js": agent,
  });
  const handle = await app.boot();
  const call = async (name: string, input: unknown, as?: string) => {
    const response = await fetch(`${url(handle)}/agent/${name}${as ? `?as=${as}` : ""}`, {
      method: "POST",
      headers: { "content-type": "application/json", connection: "close" },
      body: JSON.stringify({ input }),
    });
    return { status: response.status, body: await response.json() };
  };

  try {
    // Guests hold no agent:invoke, so the route itself refuses first; a role that reaches the endpoint without the tool's permission is refused by the tool.
    expect(await call("probe_reset", { confirm: true })).toMatchObject({ status: 401 });
    expect(await call("probe_reset", { confirm: true }, "viewer")).toMatchObject({ status: 403, body: { errors: [{ code: "FORBIDDEN", message: 'role "viewer" may not probe:reset' }] } });
    expect(await call("nope", {}, "user")).toMatchObject({ status: 404, body: { errors: [{ code: "NO_SUCH_TOOL" }] } });
    expect(await call("probe_read", {}, "user")).toMatchObject({ status: 400, body: { errors: [{ code: "ROUTE_TOOL", message: expect.stringContaining("GET /things") }] } });
    expect(await call("probe_reset", { confirm: false }, "user")).toMatchObject({ status: 422, body: { errors: [{ field: "confirm" }] } });
    expect(await call("probe_reset", { confirm: true }, "user")).toEqual({
      status: 200,
      body: { success: true, data: { reset: true, by: "user", reason: "none", mode: "backend" }, errors: [], meta: {} },
    });
    expect(await call("probe_count", undefined, "admin")).toMatchObject({ status: 200, body: { data: 0 } });
  } finally {
    await handle.shutdown();
  }
});

test("a custom access checker decides on actions too, and the manifest stops filtering", async () => {
  const app = await fixture({
    "modules/probe/module.acl.js": acl,
    "modules/probe/routes/probe.routes.js": routes.replace("export default ctx => {", "export default ctx => { ctx.routes.setAccessChecker((req, info) => req.headers['x-key'] === 'open' || info.id === 'agent:invoke');"),
    "modules/probe/agent/probe.agent.js": agent,
  });
  const handle = await app.boot();
  try {
    expect(handle.ctx.agent!.manifest("guest")).toMatchObject({ authorization: "dynamic", tools: expect.arrayContaining([expect.objectContaining({ name: "probe_reset" })]) });
    const call = (headers: Record<string, string>) => fetch(`${url(handle)}/agent/probe_count`, {
      method: "POST", headers: { "content-type": "application/json", connection: "close", ...headers }, body: "{}",
    });
    const denied = await call({});
    expect({ status: denied.status, body: await denied.json() }).toMatchObject({ status: 401 });
    expect((await call({ "x-key": "open" })).status).toBe(200);
  } finally {
    await handle.shutdown();
  }
});

test("agent declarations are refused with the module, file and reason", async () => {
  const base = { "modules/probe/module.acl.js": acl, "modules/probe/routes/probe.routes.js": routes };

  const unknownRoute = await fixture({ ...base, "modules/probe/agent/probe.agent.js": `
    import { defineAgent } from '@tulipes/core/agent';
    export default defineAgent({ tools: [{ route: 'probe:nope' }] });` });
  await expect(unknownRoute.boot({ listen: false })).rejects.toThrow(/\[probe\] route "probe:nope" matches no endpoint this module declares \(known: probe:read, probe:write, agent:invoke\)/);

  const notDeclared = await fixture({ ...base, "modules/probe/agent/probe.agent.js": `export default { tools: [] };` });
  await expect(notDeclared.boot({ listen: false })).rejects.toThrow(/\[probe\] .*probe\.agent\.js must default-export defineAgent/);

  const malformed = await fixture({ ...base, "modules/probe/agent/probe.agent.js": `
    import { defineAgent } from '@tulipes/core/agent';
    export default defineAgent({ tools: [{ id: 'Reset', handler: 1 }] });` });
  await expect(malformed.boot({ listen: false })).rejects.toThrow(/tools\[0\]\.id must be a "<module>:<action>" permission[\s\S]*tools\[0\]\.description is required[\s\S]*tools\[0\]\.handler must be a function/);

  const collision = await fixture({ ...base, "modules/probe/agent/probe.agent.js": `
    import { defineAgent } from '@tulipes/core/agent';
    export default defineAgent({ tools: [{ route: '*' }, { id: 'probe:read', description: 'Clashes with the route tool', handler: () => 1 }] });` });
  await expect(collision.boot({ listen: false })).rejects.toThrow(/\[probe\] tool "probe_read" \(probe:read\) is already exposed by module "probe" as "probe:read"/);

  const two = await fixture({ ...base, "modules/probe/agent/a.agent.js": agent, "modules/probe/agent/b.agent.js": agent });
  await expect(two.boot({ listen: false })).rejects.toThrow(/\[probe\] one agent\/\*\.agent file per module — found 2/);
});

test("worker and script processes carry no agent surface", async () => {
  const app = await fixture({ "modules/probe/module.acl.js": acl, "modules/probe/routes/probe.routes.js": routes });
  const handle = await app.boot({ mode: "script" });
  expect(handle.ctx.agent).toBeUndefined();
  await handle.shutdown();
});
