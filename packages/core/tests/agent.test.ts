import { expect, test } from "vitest";
import { fixture, url } from "./fixture.ts";

/**
 * The agent surface: a module's `agent/` declaration lists the actions it
 * offers, routes are never tools, the manifest is filtered by role, the
 * registry exists in every mode, and an action runs through the same gate
 * a route has — ACL, then validation, then the handler.
 */

const acl = `export default acl => acl.defineRole('guest').defineRole('viewer').defineRole('user').defineRole('admin')
  .allow('guest', 'probe:count').allow('viewer', 'agent:*').allow('user', 'probe:*', 'agent:*').allow('admin', 'probe:*', 'agent:*');`;

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
    r.get('/things', ctx.rai({ id: 'probe:read', name: 'List things' }), (req, res) => res.respond({ data: [] }));
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
    actions: [
      action({
        id: 'probe:reset',
        title: 'Reset',
        description: 'Reset every thing',
        input: z.object({ confirm: z.literal(true), reason: z.string().default('none') }),
        handler: (ctx, input, actor) => ({ reset: true, by: actor.role, reason: input.reason, mode: ctx.mode }),
      }),
      action({ id: 'probe:count', description: 'How many things', readOnly: true, handler: () => 0 }),
    ],
  });
`;

test("the manifest lists declared actions only, never routes, filtered by role", async () => {
  const app = await fixture({
    "modules/probe/module.acl.js": acl,
    "modules/probe/routes/probe.routes.js": routes,
    "modules/probe/agent/probe.agent.js": agent,
  });
  const handle = await app.boot({ listen: false });
  const registry = handle.ctx.agent!;

  expect(registry.manifest()).toMatchObject({ authorization: "acl", modules: [{ name: "probe", summary: "Keeps things.", tools: ["probe_reset", "probe_count"] }] });
  expect(registry.find("probe_reset")).toEqual({
    name: "probe_reset", module: "probe", permission: "probe:reset", title: "Reset", description: "Reset every thing", read_only: false,
    input_schema: { type: "object", properties: { confirm: { type: "boolean", const: true }, reason: { type: "string", default: "none" } }, required: ["confirm"], additionalProperties: false },
  });
  expect(registry.find("probe_count")).toMatchObject({ read_only: true, input_schema: { type: "object", properties: {}, additionalProperties: false } });
  expect(registry.find("probe_read")).toBeUndefined();

  expect(registry.manifest("guest").tools.map((tool) => tool.name)).toEqual(["probe_count"]);
  expect(registry.manifest("user").tools.map((tool) => tool.name)).toEqual(["probe_reset", "probe_count"]);
  expect(registry.manifest("nobody")).toMatchObject({ modules: [{ name: "probe", summary: "Keeps things.", tools: [] }], tools: [] });
  await handle.shutdown();
});

test("a module without a declaration offers nothing", async () => {
  const app = await fixture({ "modules/probe/module.acl.js": acl, "modules/probe/routes/probe.routes.js": routes });
  const handle = await app.boot({ listen: false });
  expect(handle.ctx.agent!.manifest()).toMatchObject({ modules: [], tools: [] });
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

  const legacy = await fixture({ ...base, "modules/probe/agent/probe.agent.js": `
    import { defineAgent } from '@tulipes/core/agent';
    export default defineAgent({ tools: [{ route: '*' }] });` });
  await expect(legacy.boot({ listen: false })).rejects.toThrow(/\[probe\] .*probe\.agent\.js: "tools" is "actions" since 0\.11\.0-rc\.3, and routes are no longer tools/);

  const routeRef = await fixture({ ...base, "modules/probe/agent/probe.agent.js": `
    import { defineAgent } from '@tulipes/core/agent';
    export default defineAgent({ actions: [{ route: 'probe:read' }] });` });
  await expect(routeRef.boot({ listen: false })).rejects.toThrow(/actions\[0\] is a route reference — routes are the API, not tools/);

  const notDeclared = await fixture({ ...base, "modules/probe/agent/probe.agent.js": `export default { actions: [] };` });
  await expect(notDeclared.boot({ listen: false })).rejects.toThrow(/\[probe\] .*probe\.agent\.js must default-export defineAgent/);

  const malformed = await fixture({ ...base, "modules/probe/agent/probe.agent.js": `
    import { defineAgent } from '@tulipes/core/agent';
    export default defineAgent({ actions: [{ id: 'Reset', handler: 1 }] });` });
  await expect(malformed.boot({ listen: false })).rejects.toThrow(/actions\[0\]\.id must be a "<module>:<action>" permission[\s\S]*actions\[0\]\.description is required[\s\S]*actions\[0\]\.handler must be a function/);

  const collision = await fixture({ ...base, "modules/probe/agent/probe.agent.js": `
    import { defineAgent } from '@tulipes/core/agent';
    export default defineAgent({ actions: [{ id: 'probe:count', description: 'One', handler: () => 1 }, { id: 'probe:count', description: 'Two', handler: () => 2 }] });` });
  await expect(collision.boot({ listen: false })).rejects.toThrow(/\[probe\] tool "probe_count" \(probe:count\) is already exposed by module "probe" as "probe:count"/);

  const two = await fixture({ ...base, "modules/probe/agent/a.agent.js": agent, "modules/probe/agent/b.agent.js": agent });
  await expect(two.boot({ listen: false })).rejects.toThrow(/\[probe\] one agent\/\*\.agent file per module — found 2/);
});

test("a script process carries the same surface and can invoke an action under the ACL", async () => {
  const app = await fixture({ "modules/probe/module.acl.js": acl, "modules/probe/agent/probe.agent.js": agent });
  const handle = await app.boot({ mode: "script" });
  try {
    const registry = handle.ctx.agent!;
    expect(registry.manifest("user").tools.map((tool) => tool.name)).toEqual(["probe_reset", "probe_count"]);
    const actor = { isAuthenticated: true, user: null, session: null };
    await expect(registry.invoke("probe_reset", { confirm: true }, { ...actor, role: "viewer" })).rejects.toMatchObject({ status: 403 });
    await expect(registry.invoke("probe_reset", { confirm: true }, { ...actor, role: "user" })).resolves.toEqual({ reset: true, by: "user", reason: "none", mode: "script" });
  } finally {
    await handle.shutdown();
  }
});
