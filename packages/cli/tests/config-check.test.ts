import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { fixture } from "../../core/tests/fixture.ts";

const cli = resolve("packages/cli/src/bin.ts");

test("config:check loads every namespace from the store and prints it; invalid stored values fail it", async () => {
  const app = await fixture({
    "modules/probe/module.config.js": `
      import { defineConfig } from '@tulipes/core/config';
      import { z } from 'zod/v4';
      export default defineConfig({ schema: z.object({ greeting: z.string().min(1).default('Hello'), port: z.number().default(1).meta({ restart: true }) }) });
    `,
  });
  const run = () => spawnSync(process.execPath, [cli, "config:check"], { cwd: app.rootDir, encoding: "utf8", timeout: 20_000, env: { ...process.env, APP_ENV: "production", PORT: "0" } });

  const first = run();
  expect(first.status, first.stdout + first.stderr).toBe(0);
  expect(first.stdout).toContain("1 settings namespace(s) in file config/settings.production.json");
  expect(first.stdout).toContain("✔ probe  v1");
  expect(first.stdout).toContain('greeting = "Hello"');

  const file = app.rootDir + "/config/settings.production.json";
  const document = JSON.parse(await readFile(file, "utf8"));
  document.probe = { ...document.probe, values: { greeting: "", port: 1 }, version: 2 };
  await app.write("config/settings.production.json", JSON.stringify(document));

  const second = run();
  expect(second.status).toBe(1);
  expect(second.stderr).toContain('stored setting "probe.greeting"');
});

test("agent manifest describes every tool offline, filtered by role when asked", async () => {
  const app = await fixture({
    "modules/probe/module.acl.js": `export default acl => acl.defineRole('guest').defineRole('admin').allow('guest', 'probe:web:read').allow('admin', 'probe:*');`,
    "modules/probe/routes/probe.routes.js": `
      import { Router } from 'express';
      import { z } from 'zod/v4';
      export default ctx => {
        const r = Router();
        r.get('/things/:id', ctx.rai({ id: 'probe:web:read', name: 'Read a thing' }), (req, res) => res.respond({ data: null }));
        r.post('/things', ctx.rai({ id: 'probe:web:write', body: z.object({ name: z.string() }) }), (req, res) => res.respond({ data: null }));
        return r;
      };
    `,
    "modules/probe/agent/probe.agent.js": `
      import { defineAgent } from '@tulipes/core/agent';
      export default defineAgent({ summary: 'Things.', actions: [
        { id: 'probe:web:read', description: 'Count things', readOnly: true, handler: () => 0 },
        { id: 'probe:web:reset', description: 'Reset', handler: () => 0 },
      ] });
    `,
  });
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, "agent", "manifest", ...args], { cwd: app.rootDir, encoding: "utf8", timeout: 20_000, env: { ...process.env, APP_ENV: "production" } });

  const all = run("--out", "docs/agent.json");
  expect(all.status, all.stdout + all.stderr).toBe(0);
  expect(all.stdout).toContain("wrote docs/agent.json: 2 tool(s) across 1 module(s)");
  const manifest = JSON.parse(await readFile(app.rootDir + "/docs/agent.json", "utf8"));
  expect(manifest.modules).toEqual([{ name: "probe", summary: "Things.", tools: ["probe_web_read", "probe_web_reset"] }]);
  // Routes are the API, not tools: no method, no path, nothing from the RAIs.
  expect(manifest.tools).toEqual([
    { name: "probe_web_read", module: "probe", permission: "probe:web:read", description: "Count things", read_only: true, input_schema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "probe_web_reset", module: "probe", permission: "probe:web:reset", description: "Reset", read_only: false, input_schema: { type: "object", properties: {}, additionalProperties: false } },
  ]);

  const guest = run("--role", "guest");
  expect(guest.status, guest.stderr).toBe(0);
  expect(JSON.parse(guest.stdout).tools.map((tool: { name: string }) => tool.name)).toEqual(["probe_web_read"]);

  expect(run("--bogus").status).toBe(2);
});

test("routes filters by scope and roles describes every role with its extras and grants", async () => {
  const app = await fixture({
    "modules/probe/module.acl.js": `export default acl => acl
      .defineRole('guest', { description: 'Anyone without a token' })
      .defineRole('admin', { description: 'Runs the back office', level: 2 })
      .allow('guest', 'probe:web:list')
      .allow('admin', 'probe:*');`,
    "modules/probe/routes/web.probe.routes.js": `
      import { Router } from 'express';
      export default ({ rai }) => {
        const r = Router();
        r.get('/probe', rai({ id: 'probe:web:list', name: 'List' }), (req, res) => res.respond({ data: [] }));
        return r;
      };
    `,
    "modules/probe/routes/bo/probe.routes.js": `
      import { Router } from 'express';
      export default ({ rai }) => {
        const r = Router();
        r.delete('/bo/probe/:id', rai({ id: 'probe:bo:detail:delete' }), (req, res) => res.respond({ data: null }));
        return r;
      };
    `,
  });
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: app.rootDir, encoding: "utf8", timeout: 20_000, env: { ...process.env, APP_ENV: "production" } });

  const all = run("routes");
  expect(all.status, all.stdout + all.stderr).toBe(0);
  expect(all.stdout).toContain("2 endpoint(s)");
  expect(all.stdout).toMatch(/DELETE\s+probe:bo:detail:delete\s+\/bo\/probe\/:id\s+probe\s+admin\n/);
  expect(all.stdout).toMatch(/GET\s+probe:web:list\s+\/probe\s+probe\s+admin, guest\n/);

  const backOffice = run("routes", "--scope", "bo");
  expect(backOffice.status, backOffice.stderr).toBe(0);
  expect(backOffice.stdout).toContain('1 endpoint(s) in scope "bo"');
  expect(backOffice.stdout).not.toContain("probe:web:list");

  const mobile = run("routes", "--scope", "mobile");
  expect(mobile.stdout).toContain('no routes in scope "mobile" — the app declares: bo, web');
  expect(run("routes", "--scope", "Bad").status).toBe(2);
  expect(run("routes", "--scope").status).toBe(2);

  const roles = run("roles");
  expect(roles.status, roles.stdout + roles.stderr).toBe(0);
  expect(roles.stdout).toContain("2 role(s)");
  expect(roles.stdout).toMatch(/guest\s+Anyone without a token\s+\(probe\)\n\s+probe:web:list\s+granted by probe\n/);
  expect(roles.stdout).toMatch(/admin\s+Runs the back office\s+\(probe\)\n\s+level=2\n\s+probe:\*\s+granted by probe\n/);

  const one = run("roles", "--role", "admin");
  expect(one.stdout).toContain("1 role(s)");
  expect(one.stdout).not.toContain("guest");

  const unknown = run("roles", "--role", "ghost");
  expect(unknown.status).toBe(2);
  expect(unknown.stderr).toContain('unknown role "ghost" — the app defines: guest, admin');
  expect(run("roles", "--bogus").status).toBe(2);
});
