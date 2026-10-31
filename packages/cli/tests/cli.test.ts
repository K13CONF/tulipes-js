import { access, readFile } from "node:fs/promises";
import { expect, test, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { runEnvCheck } from "../src/env-check.ts";
import { runNewModule } from "../src/new-module.ts";
import { runSpec } from "../src/spec.ts";
import { runSync } from "../src/sync.ts";
import { runInit } from "../src/init.ts";
import { fixture } from "../../core/tests/fixture.ts";

test("a generated kebab-case module produces valid TypeScript configuration declarations", async () => {
  const app = await fixture({
    "modules/core/package.json": '{"name":"@test/core","type":"module"}',
  });

  await runNewModule(app.rootDir, "billing-history");

  await runSync(app.rootDir);

  const path = app.rootDir + "/types/tulipes.d.ts";

  const result = spawnSync(
    resolve("node_modules/.bin/tsc"),
    [path, "--noEmit", "--skipLibCheck", "--allowImportingTsExtensions"],
    { encoding: "utf8" },
  );

  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(await readFile(path, "utf8")).toContain('"billing-history"?');
});

test("new module names its routes and controllers scope-first and declares a three-segment RAI", async () => {
  const exists = (path: string) => access(path).then(() => true, () => false);
  const app = await fixture({ "modules/core/package.json": '{"name":"@test/core","type":"module"}' });

  await runNewModule(app.rootDir, "billing");
  await runNewModule(app.rootDir, "invoices", { scope: "bo" });

  const web = await readFile(app.rootDir + "/modules/billing/routes/web.billing.routes.ts", "utf8");
  expect(web).toContain('ctx.rai({ id: "billing:web:list", name: "List billing" })');
  expect(web).toContain('import { WebBillingController } from "../controllers/web.billing.controllers.ts"');
  expect(await exists(app.rootDir + "/modules/billing/controllers/web.billing.controllers.ts")).toBe(true);
  expect(await readFile(app.rootDir + "/modules/billing/module.acl.ts", "utf8")).toContain('_acl.allow("user", "billing:web:list")');

  const bo = await readFile(app.rootDir + "/modules/invoices/routes/bo.invoices.routes.ts", "utf8");
  expect(bo).toContain('id: "invoices:bo:list"');
  expect(await readFile(app.rootDir + "/modules/invoices/controllers/bo.invoices.controllers.ts", "utf8")).toContain("export class BoInvoicesController {");

  // The scaffold boots: the id passes the route scan.
  await app.write("modules/billing/module.acl.ts", `export default (acl) => acl.defineRole("guest").allow("guest", "billing:*");`);
  const handle = await app.boot({ inspect: true });
  expect(handle.ctx.routes.all().map(({ info }) => info.id)).toEqual(["billing:web:list", "invoices:bo:list"]);
  await handle.shutdown();

  const previous = process.exitCode;
  await runNewModule(app.rootDir, "broken", { scope: "Back Office" });
  expect(process.exitCode).toBe(2);
  expect(await exists(app.rootDir + "/modules/broken")).toBe(false);
  process.exitCode = previous;
});

test("new module emits model and bootstrap files only for apps that declare a models provider", async () => {
  const exists = (path: string) => access(path).then(() => true, () => false);

  const bare = await fixture({ "modules/core/package.json": '{"name":"@test/core","type":"module"}' });
  await runNewModule(bare.rootDir, "notes");
  expect(await exists(bare.rootDir + "/modules/notes/models/notes.model.ts")).toBe(false);
  expect(await exists(bare.rootDir + "/modules/notes/bootstrap/notes.bootstrap.ts")).toBe(false);
  expect(JSON.parse(await readFile(bare.rootDir + "/modules/notes/package.json", "utf8")).dependencies).not.toHaveProperty("mongoose");

  await runNewModule(bare.rootDir, "forced", { models: true });
  expect(await exists(bare.rootDir + "/modules/forced/models/forced.model.ts")).toBe(true);
  await expect(bare.boot({ mode: "script" })).rejects.toThrow(/\[forced\] requires capability "models"/);

  const declared = await fixture({
    "package.json": JSON.stringify({ type: "module", tulipes: { providers: { models: "@tulipes/mongoose" } } }),
    "modules/core/package.json": '{"name":"@test/core","type":"module"}',
  });
  await runNewModule(declared.rootDir, "notes");
  expect(await readFile(declared.rootDir + "/modules/notes/models/notes.model.ts", "utf8")).toContain('from "@tulipes/mongoose"');
  expect(JSON.parse(await readFile(declared.rootDir + "/modules/notes/package.json", "utf8")).dependencies).toMatchObject({ "@tulipes/mongoose": `^${JSON.parse(await readFile(new URL("../../mongoose/package.json", import.meta.url), "utf8")).version}`, mongoose: "^8" });

  await runNewModule(declared.rootDir, "plain", { models: false });
  expect(await exists(declared.rootDir + "/modules/plain/models")).toBe(false);
});

test.each([false, true])(
  "generated authentication isolates guests before rai, with Passport: %s",
  async (withPassport) => {
    const app = await fixture();

    await runInit(app.rootDir, "generated", "production");

    await app.write(
      "generated/check-auth.ts",
      `
    import assert from 'node:assert/strict';
    import { once } from 'node:events';
    import express from 'express';
    import passport from 'passport';
    import { Strategy, ExtractJwt } from 'passport-jwt';
    import { auth } from './modules/auth/helpers/auth.ts';
    import { authenticate } from './modules/auth/helpers/passport.ts';
    const app = express();
    if (${withPassport}) {
      passport.use(new Strategy({
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: 'test-only',
      }, () => { throw new Error('no token should reach verification'); }));
      app.use(authenticate());
    }
    const requestAuth = req => ${withPassport} ? req.auth : auth(req);
    app.get('/change', (req, res) => {
      requestAuth(req).isAuthenticated = true;
      res.json({ authenticated: requestAuth(req).isAuthenticated });
    });
    app.get('/guest', (req, res) => { res.json({ authenticated: requestAuth(req).isAuthenticated }); });
    const server = app.listen(0, '127.0.0.1');
    try {
      await once(server, 'listening');
      const base = 'http://127.0.0.1:' + server.address().port;
      const get = async path => (await fetch(base + path, { headers: { connection: 'close' } })).json();
      assert.deepEqual(await get('/change'), { authenticated: true });
      assert.deepEqual(await get('/guest'), { authenticated: false });
    } finally { await new Promise(resolve => server.close(resolve)); }
  `,
    );

    const result = spawnSync(
      process.execPath,
      [app.rootDir + "/generated/check-auth.ts"],
      {
        encoding: "utf8",
        timeout: 5_000,
      },
    );

    expect(result.status, result.stdout + result.stderr).toBe(0);
  },
);

test("sync types models from their files and job data from the queues' schemas", async () => {
  const app = await fixture({
    "package.json": JSON.stringify({ type: "module", tulipes: { providers: { models: "@tulipes/mongoose", queues: "@tulipes/bullmq" } } }),
    "modules/probe/package.json": '{"name":"@test/probe","type":"module"}',
    "modules/probe/models/thing.model.ts": `
      import { Schema } from "mongoose";
      import type { ModelDef } from "@tulipes/mongoose";
      export default { name: "Thing", schema: new Schema({ label: { type: String, required: true } }) } satisfies ModelDef;
    `,
    "modules/probe/models/dynamic.model.ts": `
      import { Schema } from "mongoose";
      const name = ["Dyn", "amic"].join("");
      export default { name, schema: new Schema({}) };
    `,
    "modules/probe/queues/probe.queues.ts": `
      import { z } from "zod/v4";
      import type { JobSchemas } from "@tulipes/bullmq";
      export const jobs = { "probe.work": z.object({ id: z.string(), tries: z.number().default(1) }) } satisfies JobSchemas;
      export default () => {};
    `,
    "modules/probe/queues/plain.queues.ts": `export default () => {};`,
    "types/config.d.ts": "// AUTO-GENERATED by `tulipes sync` — do not edit.\n",
    "types/probe.ts": `
      import type { ModelsCapability, QueuesCapability } from "@tulipes/core/boot";
      import type { KnownModel, KnownModelName } from "@tulipes/mongoose";
      import type { KnownJobs } from "@tulipes/bullmq";
      declare const models: ModelsCapability;
      declare const queues: QueuesCapability;

      const known: KnownModelName = "Thing";
      // @ts-expect-error The dynamic name stayed out of KnownModels.
      const unknown: KnownModelName = "Dynamic";
      const Thing: KnownModel<"Thing"> = models.get("Thing");
      const label: string = new Thing({ label: "x" }).label;
      // @ts-expect-error The schema says string.
      const wrong: number = new Thing({ label: "x" }).label;
      // A caller-side generic still works for names codegen does not know.
      const dynamic = models.get<{ anything: number }>("Dynamic");

      const data: KnownJobs["probe.work"] = { id: "x", tries: 1 };
      void queues.add("probe.work", "run", { id: "x", tries: 2 });
      // @ts-expect-error The payload must match the queue's schema.
      void queues.add("probe.work", "run", { id: 1 });
      // A dynamic queue name takes any payload.
      void queues.add(String(known), "run", 1);
      void [unknown, label, wrong, dynamic, data];
    `,
  });

  await runSync(app.rootDir);

  const dts = await readFile(app.rootDir + "/types/tulipes.d.ts", "utf8");
  expect(dts).toContain('"Thing": (typeof import("./../modules/probe/models/thing.model.ts"))["default"];');
  expect(dts).not.toContain("Dynamic");
  expect(dts).toContain('JobsOf<typeof import("./../modules/probe/queues/plain.queues.ts")>,');
  expect(dts).toContain('JobsOf<typeof import("./../modules/probe/queues/probe.queues.ts")> {}');
  await expect(access(app.rootDir + "/types/config.d.ts")).rejects.toThrow();

  const result = spawnSync(
    resolve("node_modules/.bin/tsc"),
    ["--noEmit", "--skipLibCheck", "--strict", "--module", "nodenext", "--target", "es2022", "--allowImportingTsExtensions", "types/tulipes.d.ts", "types/probe.ts"],
    { cwd: app.rootDir, encoding: "utf8" },
  );
  expect(result.status, result.stdout + result.stderr).toBe(0);
});

test("sync leaves the provider augmentations out of an app with no model or queue files", async () => {
  const app = await fixture({ "modules/core/package.json": '{"name":"@test/core","type":"module"}' });
  await runSync(app.rootDir);
  const dts = await readFile(app.rootDir + "/types/tulipes.d.ts", "utf8");
  expect(dts).not.toContain("@tulipes/mongoose");
  expect(dts).not.toContain("@tulipes/bullmq");
});

const billingManifest = JSON.stringify({ name: "@test/billing", type: "module", tulipes: { env: {
  apiKey: { key: "BILLING_API_KEY", type: "secret", required: true, group: "stripe", description: "Stripe secret key" },
  trialDays: { key: "BILLING_TRIAL_DAYS", type: "number", default: 14, description: "Days before the first charge" },
  region: { key: "BILLING_REGION", type: "enum", enum: ["eu", "us"], description: "Optional: no default, not required" },
} } });

test("sync types environment values for the app config and the module namespace, and writes .env.example by variable", async () => {
  const app = await fixture({
    "modules/core/package.json": '{"name":"@test/core","type":"module"}',
    "modules/billing/package.json": billingManifest,
    "modules/billing/module.config.ts": `
      import { defineConfig } from "@tulipes/core/config";
      import { z } from "zod/v4";
      export default defineConfig({ schema: z.object({ currency: z.string().default("EUR") }) });
    `,
  });

  await runSync(app.rootDir);

  const dts = await readFile(app.rootDir + "/types/tulipes.d.ts", "utf8");
  expect(dts).toContain('interface EnvValues {\n    "billing": {');
  expect(dts).toContain("readonly apiKey: string;");
  expect(dts).toContain("readonly trialDays: number;");
  expect(dts).toContain('readonly region: "eu" | "us" | undefined;');
  // Both halves of the namespace, one type.
  expect(dts).toMatch(/"billing"\?: \(typeof import\("[^"]+"\)\)\["default"\]\["schema"\]\["_zod"\]\["output"\]\s*& EnvValues\["billing"\];/);
  expect(dts).not.toContain("KnownVariables");
  const result = spawnSync(resolve("node_modules/.bin/tsc"), [app.rootDir + "/types/tulipes.d.ts", "--noEmit", "--skipLibCheck", "--allowImportingTsExtensions"], { encoding: "utf8" });
  expect(result.status, result.stdout + result.stderr).toBe(0);

  const example = await readFile(app.rootDir + "/.env.example", "utf8");
  expect(example).toContain("# ━━━ billing ━━━");
  expect(example).toContain("# ── stripe ──\n# Stripe secret key (secret, REQUIRED) → config.billing.apiKey\nBILLING_API_KEY=");
  expect(example).toContain("BILLING_TRIAL_DAYS=14");
});

test("env:check shows where each value lands and from which source, redacts secrets, and fails on a missing one", async () => {
  const app = await fixture({ "modules/billing/package.json": billingManifest, ".envs/.env.development": "BILLING_TRIAL_DAYS=30\n" });
  const logs: string[] = [];
  const errors: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(line));
  vi.spyOn(console, "error").mockImplementation((line: string) => void errors.push(line));
  const previous = process.exitCode;
  try {
    vi.stubEnv("APP_ENV", undefined);
    vi.stubEnv("BILLING_API_KEY", "sk_live_do_not_print");
    await runEnvCheck(app.rootDir);
    expect(process.exitCode).toBe(previous);
    expect(logs).toEqual([
      "APP_ENV=development — 3 variable(s) resolved:",
      "  ✔ config.billing.apiKey ← BILLING_API_KEY=•••",
      "  ✔ config.billing.trialDays ← BILLING_TRIAL_DAYS=30",
      "  ✔ config.billing.region ← BILLING_REGION=(not set)",
    ]);
    expect(logs.join("\n")).not.toContain("sk_live");

    vi.stubEnv("BILLING_API_KEY", undefined);
    await runEnvCheck(app.rootDir);
    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/required variable "BILLING_API_KEY" has no value/);
  } finally {
    process.exitCode = previous;
    vi.restoreAllMocks();
  }
});

const specRoute = `
  import { Router } from 'express';
  export default ({ rai }) => {
    const router = Router();
    router.get('/probe', rai({ id: 'probe:web:read' }), (req, res) => res.respond({ data: 1 }));
    return router;
  };
`;
const specAcl = `export default acl => { acl.defineRole('guest').allow('guest', 'probe:web:read'); };`;
const publicDomainSpec = (type: "string" | "secret") => JSON.stringify({ name: "@test/core", type: "module", tulipes: { env: {
  publicDomain: { key: "PUBLIC_DOMAIN", type, default: "localhost", description: "Where the app is reachable" },
} } });

/** `runSpec` over a one-route app; returns the first server the OpenAPI document advertises. */
async function specServer(files: Record<string, string>): Promise<string> {
  const app = await fixture({
    "modules/probe/routes/probe.routes.js": specRoute,
    "modules/probe/module.acl.js": specAcl,
    ...files,
  });
  const target = `${app.rootDir}/openapi.json`;
  const exit = process.exitCode;
  await runSpec(app.rootDir, { openapi: target });
  expect(process.exitCode).toBe(exit);
  const document = JSON.parse(await readFile(target, "utf8")) as { servers: { url: string }[] };
  return document.servers[0]!.url;
}

test("spec reads publicDomain declared as an environment value without evaluating its getter", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("PUBLIC_DOMAIN", "api.example.test");
  expect(await specServer({ "modules/core/package.json": publicDomainSpec("string") })).toBe("https://api.example.test");

  vi.stubEnv("PUBLIC_DOMAIN", undefined);
  expect(await specServer({ "modules/core/package.json": publicDomainSpec("string") })).toBe("http://localhost:3000");
});

test("spec reads publicDomain declared as a setting, as the reference app does", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const core = {
    "modules/core/package.json": '{"name":"@test/core","type":"module"}',
    "modules/core/module.config.js": `
      import { defineConfig } from "@tulipes/core/config";
      import { z } from "zod/v4";
      export default defineConfig({ schema: z.object({ publicDomain: z.string().default("docs.example.test") }) });
    `,
  };
  expect(await specServer(core)).toBe("https://docs.example.test");
});

test("spec never advertises a secret named publicDomain", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("PUBLIC_DOMAIN", "hunter2.example.test");
  expect(await specServer({ "modules/core/package.json": publicDomainSpec("secret") })).toBe("http://localhost:3000");
});
