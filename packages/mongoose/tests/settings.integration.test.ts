import mongoose from "mongoose";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SettingsConflictError } from "@tulipes/core/config";
import { fixture } from "../../core/tests/fixture.js";
import { MongoSettingsStore } from "../src/settings-store.js";

/**
 * S02 — the Mongo settings store against the real driver: the document
 * shape, the optimistic version, the history, propagation between two
 * stores (two processes) and the provider wired through a boot. CI runs a
 * standalone server, so the watch exercised here is the polling fallback;
 * the change-stream path runs in failure-smoke.mjs against a replica set.
 */

const mongo = process.env.TEST_MONGO_URI;
const integration = test.skipIf(!mongo);
const openConnections = () => mongoose.connections.filter((c) => c.readyState !== 0);

beforeEach(() => {
  if (mongo) vi.stubEnv("MONGO_URI", mongo);
});

afterEach(async () => {
  await Promise.all(openConnections().map((c) => c.close()));
});

async function connect(): Promise<mongoose.Connection> {
  const connection = mongoose.createConnection(mongo!, { serverSelectionTimeoutMS: 5_000 });
  await connection.asPromise();
  return connection;
}

const ns = () => `probe_${Math.random().toString(36).slice(2, 8)}`;

integration("a namespace is seeded at version 1, saved with its expected version, and a stale write is refused with the current document", async () => {
  const connection = await connect();
  const store = new MongoSettingsStore(connection);
  const namespace = ns();

  expect(await store.load(namespace)).toBeUndefined();
  const seeded = await store.save(namespace, { greeting: "Hello" }, 0, { id: "system" });
  expect(seeded).toMatchObject({ values: { greeting: "Hello" }, version: 1, updated_by: { id: "system" } });
  expect(seeded.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

  await expect(store.save(namespace, { greeting: "Again" }, 0, { id: "late" })).rejects.toThrow(SettingsConflictError);

  const written = await store.save(namespace, { greeting: "Hi" }, 1, { id: "operator", label: "Op" });
  expect(written).toMatchObject({ version: 2, updated_by: { id: "operator", label: "Op" } });
  expect(await store.load(namespace)).toMatchObject({ values: { greeting: "Hi" }, version: 2 });

  const stale = await store.save(namespace, { greeting: "Stale" }, 1, { id: "other" }).catch((error: unknown) => error);
  expect(stale).toBeInstanceOf(SettingsConflictError);
  expect((stale as SettingsConflictError).current).toMatchObject({ values: { greeting: "Hi" }, version: 2 });

  const history = await connection.collection("settings_history").find({ namespace }).toArray();
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ namespace, values: { greeting: "Hello" }, version: 1, updated_by: { id: "system" }, replaced_by: { id: "operator", label: "Op" } });
  expect(history[0]!.replaced_at).toBeInstanceOf(Date);

  const raw = await connection.collection("settings").findOne({ _id: namespace as never });
  expect(raw).toMatchObject({ _id: namespace, values: { greeting: "Hi" }, version: 2 });
  expect(raw!.updated_at).toBeInstanceOf(Date);
  await store.dispose();
});

integration("a write in one process reaches another's watch within the poll interval, once, and never its own", async () => {
  const [a, b] = [await connect(), await connect()];
  const first = new MongoSettingsStore(a, { pollIntervalMs: 100 });
  const second = new MongoSettingsStore(b, { pollIntervalMs: 100 });
  const namespace = ns();
  await first.save(namespace, { greeting: "Hello" }, 0, { id: "system" });
  await second.load(namespace);

  const seenByFirst: unknown[] = [];
  const seenBySecond: unknown[] = [];
  const stopFirst = first.watch((name, stored) => seenByFirst.push([name, stored.version]));
  const stopSecond = second.watch((name, stored) => seenBySecond.push([name, stored.version, stored.values]));

  await first.save(namespace, { greeting: "Hi" }, 1, { id: "operator" });
  await expect.poll(() => seenBySecond, { timeout: 5_000 }).toEqual([[namespace, 2, { greeting: "Hi" }]]);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(seenBySecond).toHaveLength(1); // not reported again on the next polls
  expect(seenByFirst).toEqual([]); // the writer already holds the version it wrote

  expect(first.status()).toMatchObject({ ready: true, label: expect.stringMatching(/^mongodb:\/\/.*\.settings \((change stream|poll)\)$/) });
  stopFirst();
  stopSecond();
  await Promise.all([first.dispose(), second.dispose()]);
});

const probe = (greeting = "Hello") => ({
  "package.json": JSON.stringify({ type: "module", tulipes: { providers: { models: "@tulipes/mongoose", settings: "@tulipes/mongoose/settings" } } }),
  "modules/probe/package.json": JSON.stringify({ name: "@test/probe", type: "module", tulipes: { env: [{ name: "MONGO_URI", type: "url", default: mongo, description: "Test database" }] } }),
  "modules/probe/module.config.js": `
    import { defineConfig } from '@tulipes/core/config';
    import { z } from 'zod/v4';
    export default defineConfig({ schema: z.object({ greeting: z.string().default(${JSON.stringify(greeting)}) }) });
  `,
});

integration("the provider shares the models connection, the manager writes through it, and a second boot reads what the first wrote", async () => {
  const database = `tulipes_settings_${Math.random().toString(36).slice(2, 8)}`;
  const uri = new URL(mongo!);
  uri.pathname = `/${database}`;
  vi.stubEnv("MONGO_URI", uri.href);
  const files = probe();
  files["modules/probe/package.json"] = JSON.stringify({ name: "@test/probe", type: "module", tulipes: { env: [{ name: "MONGO_URI", type: "url", default: uri.href, description: "Test database" }] } });

  const first = await (await fixture(files)).boot({ mode: "script" });
  try {
    expect(first.providers.map((status) => [status.capability, status.provider, status.ready])).toEqual([["models", "mongoose", true], ["settings", "mongoose-settings", true]]);
    expect(first.ctx.settings.status().label).toMatch(new RegExp(`/${database}\\.settings`));
    expect(openConnections()).toHaveLength(1); // one connection, shared
    expect(first.ctx.config.probe).toEqual({ greeting: "Hello" });
    await first.ctx.settings.set("probe", { greeting: "Written" }, { id: "operator" });
  } finally {
    await first.shutdown();
  }
  expect(openConnections()).toHaveLength(0);

  const second = await (await fixture(files)).boot({ mode: "script" });
  try {
    expect(second.ctx.config.probe).toEqual({ greeting: "Written" });
    expect(second.ctx.settings.describe("probe").stored).toMatchObject({ version: 2, updated_by: { id: "operator" } });
  } finally {
    await second.shutdown();
    await (await connect()).dropDatabase().catch(() => undefined);
  }
});

integration("without a models provider the settings provider opens and closes its own connection", async () => {
  const files = probe();
  files["package.json"] = JSON.stringify({ type: "module", tulipes: { providers: { settings: "@tulipes/mongoose/settings" } } });
  const handle = await (await fixture(files)).boot({ mode: "script" });
  try {
    expect(handle.ctx.models).toBeUndefined();
    expect(handle.providers).toEqual([{ capability: "settings", provider: "mongoose-settings", label: expect.stringMatching(/^mongodb:\/\//), ready: true }]);
    expect(openConnections()).toHaveLength(1);
  } finally {
    await handle.shutdown();
  }
  expect(openConnections()).toHaveLength(0);

  vi.stubEnv("MONGO_URI", "mongodb://127.0.0.1:1/unreachable");
  const unreachable = await fixture({ ...files, "modules/probe/package.json": JSON.stringify({ name: "@test/probe", type: "module", tulipes: { env: [{ name: "MONGO_URI", type: "url", required: true, description: "Test database" }] } }) });
  await expect(unreachable.boot({ mode: "script" })).rejects.toThrow(/settings database connection failed \(MONGO_URI\)/);
  expect(openConnections()).toHaveLength(0);
});
