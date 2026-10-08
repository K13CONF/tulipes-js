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
    "modules/probe/module.acl.js": `export default acl => acl.defineRole('guest').defineRole('admin').allow('guest', 'probe:read').allow('admin', 'probe:*');`,
    "modules/probe/routes/probe.routes.js": `
      import { Router } from 'express';
      import { z } from 'zod/v4';
      export default ctx => {
        const r = Router();
        r.get('/things/:id', ctx.rai({ id: 'probe:read', name: 'Read a thing' }), (req, res) => res.respond({ data: null }));
        r.post('/things', ctx.rai({ id: 'probe:write', body: z.object({ name: z.string() }) }), (req, res) => res.respond({ data: null }));
        return r;
      };
    `,
    "modules/probe/agent/probe.agent.js": `
      import { defineAgent } from '@tulipes/core/agent';
      export default defineAgent({ summary: 'Things.', actions: [
        { id: 'probe:read', description: 'Count things', readOnly: true, handler: () => 0 },
        { id: 'probe:reset', description: 'Reset', handler: () => 0 },
      ] });
    `,
  });
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, "agent", "manifest", ...args], { cwd: app.rootDir, encoding: "utf8", timeout: 20_000, env: { ...process.env, APP_ENV: "production" } });

  const all = run("--out", "docs/agent.json");
  expect(all.status, all.stdout + all.stderr).toBe(0);
  expect(all.stdout).toContain("wrote docs/agent.json: 2 tool(s) across 1 module(s)");
  const manifest = JSON.parse(await readFile(app.rootDir + "/docs/agent.json", "utf8"));
  expect(manifest.modules).toEqual([{ name: "probe", summary: "Things.", tools: ["probe_read", "probe_reset"] }]);
  // Routes are the API, not tools: no method, no path, nothing from the RAIs.
  expect(manifest.tools).toEqual([
    { name: "probe_read", module: "probe", permission: "probe:read", description: "Count things", read_only: true, input_schema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "probe_reset", module: "probe", permission: "probe:reset", description: "Reset", read_only: false, input_schema: { type: "object", properties: {}, additionalProperties: false } },
  ]);

  const guest = run("--role", "guest");
  expect(guest.status, guest.stderr).toBe(0);
  expect(JSON.parse(guest.stdout).tools.map((tool: { name: string }) => tool.name)).toEqual(["probe_read"]);

  expect(run("--bogus").status).toBe(2);
});
