import { readFile, writeFile } from "node:fs/promises";
import { expect, test, vi } from "vitest";
import { printStartupBanner } from "../src/boot/banner.ts";
import { SettingsValidationError } from "../src/config/settings.ts";
import { fixture } from "./fixture.ts";

const declaration = (fields: string, extra = "") => `
  import { defineConfig } from '@tulipes/core/config';
  import { z } from 'zod/v4';
  export default defineConfig({ schema: z.object({ ${fields} })${extra} });
`;

const greeting = `greeting: z.string().min(1).default('Hello').describe('Word to greet with'), limit: z.number().int().positive().default(5)`;
const settingsFile = (rootDir: string) => rootDir + "/config/settings.production.json";

test("a namespace never written is seeded with its defaults on first boot, versioned and attributed", async () => {
  const app = await fixture({ "modules/probe/module.config.js": declaration(greeting) });

  const handle = await app.boot({ mode: "script" });

  expect(handle.ctx.config.probe).toEqual({ greeting: "Hello", limit: 5 });
  expect(handle.ctx.settings.namespaces()).toEqual(["probe"]);

  const stored = JSON.parse(await readFile(settingsFile(app.rootDir), "utf8"));
  expect(stored.probe).toMatchObject({ values: { greeting: "Hello", limit: 5 }, version: 1, updated_by: { id: "system" } });

  const description = handle.ctx.settings.describe("probe");
  expect(description.schema).toMatchObject({ type: "object", properties: { greeting: { type: "string", description: "Word to greet with" } } });
  expect(description.stored.version).toBe(1);
  expect(description.pendingRestart).toEqual([]);

  await handle.shutdown();
});

test("a write validates over the stored values, persists, applies in place and runs onChange", async () => {
  const app = await fixture({
    "modules/probe/module.config.js": declaration(greeting, `, onChange(next, ctx) { globalThis.__changes = (globalThis.__changes ?? []).concat([{ ...next }]); }`),
  });
  (globalThis as { __changes?: unknown[] }).__changes = [];

  const handle = await app.boot({ mode: "script" });
  const live = handle.ctx.config.probe!;

  const write = await handle.ctx.settings.set("probe", { greeting: "Hi" }, { id: "u1", label: "tester" });

  expect(write).toEqual({ values: { greeting: "Hi", limit: 5 }, version: 2, requiresRestart: [] });
  expect(handle.ctx.config.probe).toBe(live); // same object: holders see the change
  expect(live).toEqual({ greeting: "Hi", limit: 5 });
  expect((globalThis as { __changes?: unknown[] }).__changes).toEqual([{ greeting: "Hi", limit: 5 }]);

  const stored = JSON.parse(await readFile(settingsFile(app.rootDir), "utf8"));
  expect(stored.probe).toMatchObject({ values: { greeting: "Hi", limit: 5 }, version: 2, updated_by: { id: "u1", label: "tester" } });

  await expect(handle.ctx.settings.set("probe", { limit: -1 }, { id: "u1" })).rejects.toBeInstanceOf(SettingsValidationError);
  await expect(handle.ctx.settings.set("probe", { limit: -1 }, { id: "u1" })).rejects.toMatchObject({ issues: [expect.objectContaining({ path: ["limit"] })] });
  expect(live.limit).toBe(5);
  expect(JSON.parse(await readFile(settingsFile(app.rootDir), "utf8")).probe.version).toBe(2);

  expect(() => handle.ctx.settings.describe("nothing")).toThrow(/no module declares settings "nothing" \(known: probe\)/);

  await handle.shutdown();
});

test("a restart-tagged field persists but keeps the running value until the next boot", async () => {
  const app = await fixture({
    "modules/probe/module.config.js": declaration(`port: z.number().int().default(3000).meta({ restart: true }), name: z.string().default('a')`),
  });

  const handle = await app.boot({ mode: "script" });
  const write = await handle.ctx.settings.set("probe", { port: 4000, name: "b" }, { id: "u1" });

  expect(write).toEqual({ values: { port: 4000, name: "b" }, version: 2, requiresRestart: ["port"] });
  expect(handle.ctx.config.probe).toEqual({ port: 3000, name: "b" });
  expect(handle.ctx.settings.describe("probe")).toMatchObject({ restart: ["port"], pendingRestart: ["port"], values: { port: 3000 }, stored: { values: { port: 4000 } } });
  await handle.shutdown();

  const next = await app.boot({ mode: "script" });
  expect(next.ctx.config.probe).toEqual({ port: 4000, name: "b" });
  expect(next.ctx.settings.describe("probe").pendingRestart).toEqual([]);
  await next.shutdown();
});

test("an invalid stored value refuses the boot and names the field and the store", async () => {
  const app = await fixture({ "modules/probe/module.config.js": declaration(greeting) });
  await app.write("config/settings.production.json", JSON.stringify({ probe: { values: { greeting: "", limit: 5 }, version: 7, updated_at: "x", updated_by: { id: "op" } } }));

  await expect(app.boot({ mode: "script" })).rejects.toThrow(/stored setting "probe\.greeting":.*\(fix it in the store, or file .*settings\.production\.json\)/);
});

test("a change written by another process is picked up, validated, applied and reported through onChange", async () => {
  const app = await fixture({
    "modules/probe/module.config.js": declaration(greeting, `, onChange(next) { globalThis.__seen = { ...next }; }`),
  });
  (globalThis as { __seen?: unknown }).__seen = undefined;

  const handle = await app.boot({ mode: "script" });
  const file = settingsFile(app.rootDir);
  const document = JSON.parse(await readFile(file, "utf8"));

  document.probe = { ...document.probe, values: { greeting: "", limit: 5 }, version: 2 };
  await writeFile(file, JSON.stringify(document));
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(handle.ctx.config.probe).toEqual({ greeting: "Hello", limit: 5 }); // invalid: ignored

  document.probe = { ...document.probe, values: { greeting: "Hey", limit: 9 }, version: 3, updated_by: { id: "other" } };
  await writeFile(file, JSON.stringify(document));
  await expect.poll(() => handle.ctx.config.probe, { timeout: 5_000 }).toEqual({ greeting: "Hey", limit: 9 });
  expect((globalThis as { __seen?: unknown }).__seen).toEqual({ greeting: "Hey", limit: 9 });
  expect(handle.ctx.settings.describe("probe").stored).toMatchObject({ version: 3, updated_by: { id: "other" } });

  await handle.shutdown();
});

test("a declaration without defaults, marked secret, or not an object is refused at boot", async () => {
  const noDefault = await fixture({ "modules/probe/module.config.js": declaration(`token: z.string()`) });
  await expect(noDefault.boot({ mode: "script" })).rejects.toThrow(/field "token" has no default — every setting needs one/);

  const secret = await fixture({ "modules/probe/module.config.js": declaration(`key: z.string().default('x').meta({ secret: true })`) });
  await expect(secret.boot({ mode: "script" })).rejects.toThrow(/field "key" is marked secret — secrets are environment variables/);

  const notObject = await fixture({
    "modules/probe/module.config.js": `
      import { defineConfig } from '@tulipes/core/config';
      import { z } from 'zod/v4';
      export default defineConfig({ schema: z.string() });
    `,
  });
  await expect(notObject.boot({ mode: "script" })).rejects.toThrow(/schema must be a zod object/);

  const plain = await fixture({ "modules/probe/module.config.js": `export default { schema: {} };` });
  await expect(plain.boot({ mode: "script" })).rejects.toThrow(/must default-export defineConfig\(\{ schema \}\)/);
});

test("a module without a declaration has no namespace and the app seed still reaches ctx.config", async () => {
  const app = await fixture({
    "config/app.config.js": `export default () => ({ app: { name: 'seeded' }, pagination: { defaultLimit: 2, maxLimit: 4 } });`,
  });

  const handle = await app.boot({ mode: "script" });
  expect(handle.ctx.settings.namespaces()).toEqual([]);
  expect(handle.ctx.config.app).toEqual({ name: "seeded" });
  expect(handle.ctx.config.probe).toBeUndefined();
  await handle.shutdown();
});

// Colour is forced on in CI, so the rows are read with ANSI stripped.
const ansi = /\u001b\[[0-9;]*m/g;
const settingsRows = (calls: unknown[][]) =>
  String(calls[0]![0]).replace(ansi, "").split("\n").filter((line) => /➜\s+Settings\s/.test(line));

const settingsProvider = { capability: "settings", provider: "mongoose-settings", label: "mongodb://store/settings (poll)", ready: true, detail: undefined, skipped: undefined };

test("the banner prints one Settings row: the provider's, carrying the namespaces", async () => {
  const app = await fixture({ "modules/probe/module.config.js": declaration(greeting) });
  const handle = await app.boot({ mode: "script" });
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  printStartupBanner({ ...handle, providers: [settingsProvider] } as never, [], 1);

  const rows = settingsRows(log.mock.calls);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toContain("mongoose-settings");
  expect(rows[0]).toContain("probe v1");
});

test("the banner prints one Settings row for the file store, and one when no module declares settings", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  const declared = await (await fixture({ "modules/probe/module.config.js": declaration(greeting) })).boot({ mode: "script" });
  printStartupBanner(declared as never, [], 1);
  expect(settingsRows(log.mock.calls)).toHaveLength(1);
  expect(settingsRows(log.mock.calls)[0]).toContain("probe v1");

  log.mockClear();
  const none = await (await fixture()).boot({ mode: "script" });
  printStartupBanner(none as never, [], 1);
  expect(settingsRows(log.mock.calls)).toHaveLength(1);
  expect(settingsRows(log.mock.calls)[0]).toContain("no module declares settings");
});

test("a module whose own zod is 4.x declares settings: boot, set, describe and the types all work", async () => {
  const app = await fixture({
    "modules/probe/module.config.js": `
      import { defineConfig } from '@tulipes/core/config';
      import { z } from 'zod4';
      export default defineConfig({ schema: z.object({
        limits: z.object({ daily: z.number().int().positive().default(10) }).default({ daily: 10 }),
        label: z.string().default('x').meta({ restart: true }),
      }) });
    `,
  });

  const handle = await app.boot({ mode: "script" });
  expect(handle.ctx.config.probe).toEqual({ limits: { daily: 10 }, label: "x" });

  const write = await handle.ctx.settings.set("probe", { limits: { daily: 25 } }, { id: "tester" } as never);
  expect(write.values).toMatchObject({ limits: { daily: 25 } });
  expect(handle.ctx.config.probe).toMatchObject({ limits: { daily: 25 } });
  await expect(handle.ctx.settings.set("probe", { limits: { daily: -1 } }, { id: "tester" } as never)).rejects.toBeInstanceOf(SettingsValidationError);

  const described = handle.ctx.settings.describe("probe");
  expect(described.restart).toEqual(["label"]);
  expect(JSON.stringify(described.schema)).toContain("daily");
});
