import mongoose from "mongoose";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fixture } from "../../core/tests/fixture.ts";
import type { ModelStore } from "../src/index.ts";

/**
 * S09.9 — the failure and omission matrix with the real driver. What core's
 * fake-provider tests prove about the seam, these prove about this provider:
 * selection semantics, requirement shapes, two boots sharing one mongoose
 * instance, and the diagnostics a misconfigured app actually sees.
 */

const mongo = process.env.TEST_MONGO_URI;
const integration = test.skipIf(!mongo);

const declared = JSON.stringify({ type: "module", tulipes: { providers: { models: "@tulipes/mongoose" } } });
const uriEnv = [{ name: "MONGO_URI", type: "url", default: mongo, description: "Test database" }];
const uriMeta = JSON.stringify({ name: "@test/probe", type: "module", tulipes: { env: uriEnv } });
const openConnections = () => mongoose.connections.filter((c) => c.readyState !== 0);

beforeEach(() => {
  if (mongo) vi.stubEnv("MONGO_URI", mongo);
});

afterEach(async () => {
  await Promise.all(openConnections().map((c) => c.close()));
  // Global plugins are process state; the two-boot test registers one.
  (mongoose as unknown as { plugins: unknown[] }).plugins.splice(0);
});

integration("a MONGO_URI without a declaration connects nothing, even with the provider installed", async () => {
  const app = await fixture({ "modules/probe/package.json": uriMeta });
  const before = mongoose.connections.length;

  const handle = await app.boot({ mode: "script" });

  expect(handle.ctx.models).toBeUndefined();
  expect(handle.providers).toEqual([]);
  expect(mongoose.connections.length).toBe(before);
});

integration("a declared provider without MONGO_URI is a boot error naming the variable", async () => {
  vi.stubEnv("MONGO_URI", undefined);
  const app = await fixture({ "package.json": declared });

  await expect(app.boot({ mode: "script" })).rejects.toThrow(
    /Boot aborted during "providers"[\s\S]*provider "mongoose" is selected but "MONGO_URI" is not declared\/set/,
  );
  expect(openConnections()).toHaveLength(0);
});

integration("an unreachable database fails inside the provider, after ownership, and is released", async () => {
  vi.stubEnv("MONGO_URI", "mongodb://127.0.0.1:1/unreachable");
  const app = await fixture({
    "package.json": declared,
    "modules/probe/package.json": JSON.stringify({ name: "@test/probe", type: "module", tulipes: { env: [{ name: "MONGO_URI", type: "url", required: true, description: "Test database" }] } }),
  });

  await expect(app.boot({ mode: "script" })).rejects.toThrow(/database connection failed \(MONGO_URI\)/);
  expect(openConnections()).toHaveLength(0);
});

integration("a module that only consumes models declares the requirement and gets an empty store", async () => {
  const app = await fixture({
    "package.json": declared,
    "modules/probe/package.json": JSON.stringify({ name: "@test/probe", type: "module", tulipes: { requires: ["models"], env: uriEnv } }),
  });

  const handle = await app.boot({ mode: "script" });
  const models = handle.ctx.models as ModelStore;

  expect(models.names()).toEqual([]);
  expect(() => models.get("User")).toThrow(/never registered by any module \(known: none\)/);
  expect(handle.providers).toEqual([{ capability: "models", provider: "mongoose", label: expect.stringMatching(/^mongodb:\/\//), ready: true }]);
});

integration("a bootstrap-only module runs its task in backend mode and is refused without a provider", async () => {
  const files = {
    "modules/probe/package.json": uriMeta,
    "modules/probe/bootstrap/mark.bootstrap.js": `
      import { writeFileSync } from 'node:fs';
      export default async (ctx) => { writeFileSync(new URL('../../../bootstrapped', import.meta.url), ctx.models.names().join(',')); };
    `,
  };

  const refused = await fixture(files);
  await expect(refused.boot({ mode: "script" })).rejects.toThrow(/\[probe\] requires capability "models" \(has bootstrap\/ files\)/);

  const app = await fixture({ ...files, "package.json": declared });
  const { readFile } = await import("node:fs/promises");

  await app.boot({ mode: "script" });
  await expect(readFile(app.rootDir + "/bootstrapped", "utf8")).rejects.toThrow(); // scripts skip bootstrap

  await app.boot({ listen: false });
  expect(await readFile(app.rootDir + "/bootstrapped", "utf8")).toBe("");
});

integration("two boots in one process own separate connections and the app's global plugin is not multiplied", async () => {
  // The app's global plugin, registered once — as the reference app does in
  // its sys core module — on the mongoose instance shared with this provider.
  let applied = 0;
  mongoose.plugin((schema) => { applied++; schema.add({ stamped: { type: Boolean, default: true } }); });

  const app = await fixture({
    "package.json": declared,
    "modules/probe/package.json": uriMeta,
    "modules/probe/models/thing.model.js": `
      import { Schema } from 'mongoose';
      export default { name: 'Thing', schema: new Schema({ name: String }) };
    `,
  });

  const first = await app.boot({ mode: "script" });
  const second = await app.boot({ mode: "script" });
  const store = (handle: typeof first) => handle.ctx.models as ModelStore;

  expect(store(first).connection).not.toBe(store(second).connection);
  expect(store(first).get("Thing")).not.toBe(store(second).get("Thing"));
  // The model file is one ESM instance, so both boots compile the same Schema
  // object; mongoose applies a global plugin once per schema, so the effect is
  // present in both boots and multiplied in neither.
  expect(applied).toBe(1);
  expect(store(first).get("Thing").schema.path("stamped")).toBeDefined();
  expect(store(second).get("Thing").schema.path("stamped")).toBeDefined();

  await first.shutdown();

  expect(store(first).connection.readyState).toBe(0);
  expect(store(second).connection.readyState).toBe(1);
  await expect(store(second).get("Thing").countDocuments()).resolves.toBeTypeOf("number");

  await second.shutdown();
  expect(openConnections()).toHaveLength(0);
});

integration("a bootstrap failure is reported with the module and file, and the connection is released", async () => {
  const app = await fixture({
    "package.json": declared,
    "modules/probe/package.json": uriMeta,
    "modules/probe/bootstrap/explode.bootstrap.js": `export default async () => { throw new Error('seed exploded'); };`,
  });

  await expect(app.boot({ listen: false })).rejects.toThrow(/\[probe\] bootstrap task .*explode\.bootstrap\.js threw: seed exploded/);
  expect(openConnections()).toHaveLength(0);
});

integration("duplicate model names across modules name both owners and abort before bootstrap", async () => {
  const model = `import { Schema } from 'mongoose'; export default { name: 'Shared', schema: new Schema({}) };`;
  const app = await fixture({
    "package.json": declared,
    "modules/probe/package.json": uriMeta,
    "modules/probe/models/shared.model.js": model,
    "modules/other/package.json": JSON.stringify({ name: "@test/other", type: "module", tulipes: { dependsOn: ["probe"] } }),
    "modules/other/models/shared.model.js": model,
    "modules/other/bootstrap/never.bootstrap.js": `import { writeFileSync } from 'node:fs'; export default () => writeFileSync(new URL('../../../ran', import.meta.url), '');`,
  });

  await expect(app.boot({ listen: false })).rejects.toThrow(/\[other\] model "Shared" is already registered by module "probe"/);
  const { access } = await import("node:fs/promises");
  await expect(access(app.rootDir + "/ran")).rejects.toThrow();
  expect(openConnections()).toHaveLength(0);
});
