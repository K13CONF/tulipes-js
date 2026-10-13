import { readFile } from "node:fs/promises";
import { expect, test, vi } from "vitest";
import { BootReport } from "../src/errors/boot-error.ts";
import { resolveEnv } from "../src/env/resolve.ts";
import type { ModuleManifest } from "../src/modules/manifest.ts";
import { fixture, url } from "./fixture.ts";

/**
 * 0.12b — one config. A module's environment values are declared in its
 * package.json, resolved once at boot and read as `ctx.config.<module>.<name>`
 * beside its settings: read-only, never serialised, never persisted, and
 * refused under inspection. `config/app.config.ts` receives them to wire
 * what core and the providers read.
 */

const manifest = (name: string, env: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name: `@test/${name}`, type: "module", tulipes: { env, ...extra } });

const probeEnv = {
  port: { key: "PROBE_PORT", type: "number", default: 0, description: "Listener" },
  token: { key: "PROBE_TOKEN", type: "secret", required: true, description: "An API token" },
  level: { key: "PROBE_LEVEL", type: "enum", enum: ["low", "high"], default: "low", description: "A level" },
  verbose: { key: "PROBE_VERBOSE", type: "boolean", default: false, description: "A flag" },
  upstream: { key: "PROBE_UPSTREAM", type: "url", description: "Optional, no default" },
};

const settingsDeclaration = `
  import { defineConfig } from '@tulipes/core/config';
  import { z } from 'zod/v4';
  export default defineConfig({ schema: z.object({ greeting: z.string().default('hello'), retries: z.number().int().default(1) }) });
`;

// ── resolution ───────────────────────────────────────────────────────────

const asManifests = (declarations: Record<string, Record<string, unknown>>): ModuleManifest[] =>
  Object.entries(declarations).map(([name, env]) => ({
    name, packageName: `@test/${name}`, dir: "/unused", tier: "app", priority: 100, dependsOn: [], requires: [], env: env as ModuleManifest["env"],
  }));

test("a value comes from the process, else the env file, else the default, and remembers which", async () => {
  const app = await fixture({ ".envs/.env.test": "PROBE_PORT=8081\nPROBE_TOKEN=from-file\n" });
  const resolve = () => {
    const report = new BootReport();
    const resolved = resolveEnv(asManifests({ probe: probeEnv }), { appEnv: "test", envsDir: app.rootDir + "/.envs" }, report);
    report.throwIfAny("environment");
    return resolved;
  };

  const fromFile = resolve();
  expect(fromFile.values).toEqual({ probe: { port: 8081, token: "from-file", level: "low", verbose: false, upstream: undefined } });
  expect(fromFile.describe("probe").map((v) => [v.name, v.source, v.isSet])).toEqual([
    ["port", "file", true], ["token", "file", true], ["level", "default", true], ["verbose", "default", true], ["upstream", undefined, false],
  ]);

  vi.stubEnv("PROBE_PORT", "9090");
  vi.stubEnv("PROBE_VERBOSE", "yes");
  const fromProcess = resolve();
  expect(fromProcess.values.probe).toMatchObject({ port: 9090, verbose: true });
  expect(fromProcess.describe("probe").find((v) => v.name === "port")?.source).toBe("process.env");

  // The values object is frozen: the app config cannot change what a module will read.
  expect(Object.isFrozen(fromProcess.values)).toBe(true);
  expect(Object.isFrozen(fromProcess.values.probe)).toBe(true);
});

test("every missing or invalid value is reported at once, by variable name", async () => {
  const app = await fixture();
  vi.stubEnv("PROBE_LEVEL", "medium");
  vi.stubEnv("PROBE_UPSTREAM", "not a url");
  const report = new BootReport();

  resolveEnv(asManifests({ probe: probeEnv }), { appEnv: "test", envsDir: app.rootDir + "/.envs" }, report);

  expect(report.issues.map((issue) => issue.message)).toEqual([
    'required variable "PROBE_TOKEN" has no value (An API token)',
    'variable "PROBE_LEVEL": "medium" is not one of: low, high',
    'variable "PROBE_UPSTREAM": "not a url" is not a valid URL',
  ]);

  // Leniently, the same input is three absent values and no issue.
  const lenient = new BootReport();
  const resolved = resolveEnv(asManifests({ probe: probeEnv }), { appEnv: "test", envsDir: app.rootDir + "/.envs", lenient: true }, lenient);
  expect(lenient.issues).toEqual([]);
  expect(resolved.values.probe).toEqual({ port: 0, token: undefined, level: undefined, verbose: false, upstream: undefined });
});

test("a secret is described without its value and snapshotted redacted", async () => {
  vi.stubEnv("PROBE_TOKEN", "s3cret-value");
  const report = new BootReport();
  const resolved = resolveEnv(asManifests({ probe: probeEnv }), { appEnv: "test", envsDir: "/nowhere" }, report);

  const token = resolved.describe("probe").find((v) => v.name === "token")!;
  expect(token).toMatchObject({ key: "PROBE_TOKEN", isSecret: true, isSet: true, value: undefined, default: undefined });
  expect(resolved.snapshot().find((line) => line.name === "token")).toEqual({ module: "probe", name: "token", key: "PROBE_TOKEN", value: "•••", redacted: true });
  expect(JSON.stringify(resolved.describe("probe")) + JSON.stringify(resolved.snapshot())).not.toContain("s3cret-value");
  // The value is still there for the module that declared it.
  expect(resolved.values.probe!.token).toBe("s3cret-value");
});

// ── the boot: ctx.config ─────────────────────────────────────────────────

const routes = `
  import { Router } from 'express';
  export default ctx => {
    const r = Router();
    r.get('/read', ctx.rai({ id: 'probe:web:read' }), (req, res) => {
      res.respond({ data: { port: ctx.config.probe.port, level: ctx.config.probe.level, greeting: ctx.config.probe.greeting } });
    });
    r.get('/leak', ctx.rai({ id: 'probe:web:leak' }), (req, res) => {
      // What a careless handler might do: hand the whole namespace to the client.
      res.respond({ data: { spread: { ...ctx.config.probe }, keys: Object.keys(ctx.config.probe), json: JSON.parse(JSON.stringify(ctx.config)) } });
    });
    return r;
  };
`;
const acl = `export default acl => acl.defineRole('guest').allow('guest', 'probe:web:*');`;
const probeApp = (files: Record<string, string> = {}) => fixture({
  "modules/probe/package.json": manifest("probe", probeEnv),
  "modules/probe/module.config.js": settingsDeclaration,
  "modules/probe/module.acl.js": acl,
  "modules/probe/routes/probe.routes.js": routes,
  ...files,
});
const get = async (handle: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["boot"]>>, path: string) =>
  (await (await fetch(url(handle) + path)).json() as { data: Record<string, unknown> }).data;

test("environment values are read beside settings, read-only, and never serialised with them", async () => {
  vi.stubEnv("PROBE_TOKEN", "s3cret-value");
  vi.stubEnv("PROBE_PORT", "4321");
  const handle = await (await probeApp()).boot();
  const probe = handle.ctx.config.probe as Record<string, unknown>;

  // Both halves of the namespace, through one object.
  expect(probe.port).toBe(4321);
  expect(probe.token).toBe("s3cret-value");
  expect(probe.greeting).toBe("hello");
  expect(await get(handle, "/read")).toEqual({ port: 4321, level: "low", greeting: "hello" });

  // Read-only: a deployment value is not something code changes.
  expect(() => { probe.port = 1; }).toThrow(TypeError);
  expect(() => { delete probe.port; }).toThrow(TypeError);

  // Invisible to anything that walks the namespace — which is what keeps a
  // secret out of a response, a log line and the settings store.
  const leaked = await get(handle, "/leak");
  expect(leaked).toEqual({ spread: { greeting: "hello", retries: 1 }, keys: ["greeting", "retries"], json: expect.any(Object) });
  expect(JSON.stringify(leaked)).not.toContain("s3cret-value");
  expect(JSON.stringify(handle.ctx.settings.describe("probe"))).not.toContain("s3cret-value");
  expect(await readFile(`${handle.ctx.settings.describe("probe") && app(handle)}/config/settings.production.json`, "utf8")).not.toContain("s3cret-value");

  // The console's view: metadata, source, and no secret.
  expect(handle.ctx.settings.describeEnv("probe").map((v) => [v.name, v.key, v.source, v.isSecret, v.value])).toEqual([
    ["port", "PROBE_PORT", "process.env", false, 4321],
    ["token", "PROBE_TOKEN", "process.env", true, undefined],
    ["level", "PROBE_LEVEL", "default", false, "low"],
    ["verbose", "PROBE_VERBOSE", "default", false, false],
    ["upstream", "PROBE_UPSTREAM", undefined, false, undefined],
  ]);
  expect(handle.ctx.settings.describeEnv("nobody")).toEqual([]);
});

/** The fixture's root, recovered from the handle: the settings file lives under it. */
function app(handle: { ctx: { modules: readonly { dir: string }[] } }): string {
  return handle.ctx.modules[0]!.dir.replace(/\/modules\/[^/]+$/, "");
}

test("a settings write, local or from another replica, keeps the environment values in place", async () => {
  vi.stubEnv("PROBE_TOKEN", "s3cret-value");
  const handle = await (await probeApp()).boot({ mode: "script" });
  const probe = handle.ctx.config.probe as Record<string, unknown>;

  await handle.ctx.settings.set("probe", { greeting: "hi" }, { id: "tests" });
  expect(probe.greeting).toBe("hi");
  expect(probe.token).toBe("s3cret-value");
  expect(handle.ctx.config.probe).toBe(probe); // the same object, so holders of it see both

  // Another replica wrote version 2 to the same store: the watch applies it in place.
  const file = `${app(handle)}/config/settings.production.json`;
  const stored = JSON.parse(await readFile(file, "utf8")) as { probe: { values: Record<string, unknown>; version: number } };
  expect(stored.probe.values).toEqual({ greeting: "hi", retries: 1 }); // the secret was never persisted
  const { writeFile } = await import("node:fs/promises");
  stored.probe = { ...stored.probe, values: { greeting: "remote", retries: 3 }, version: stored.probe.version + 1 };
  await writeFile(file, JSON.stringify(stored));
  await expect.poll(() => probe.greeting, { timeout: 5_000 }).toBe("remote");
  expect(probe.retries).toBe(3);
  expect(probe.token).toBe("s3cret-value");
});

test("a module without settings still gets its namespace; a name used by both halves is refused", async () => {
  vi.stubEnv("PROBE_TOKEN", "x");
  const settingsFree = await fixture({ "modules/probe/package.json": manifest("probe", probeEnv) });
  const handle = await settingsFree.boot({ mode: "script" });
  expect((handle.ctx.config.probe as Record<string, unknown>).level).toBe("low");
  expect(Object.keys(handle.ctx.config.probe!)).toEqual([]);
  await handle.shutdown();

  const clashing = await fixture({
    "modules/probe/package.json": manifest("probe", { greeting: { key: "PROBE_GREETING", type: "string", default: "env", description: "Clashes with the setting" } }),
    "modules/probe/module.config.js": settingsDeclaration,
  });
  await expect(clashing.boot({ mode: "script" })).rejects.toThrow(/config\.probe\.greeting is both a setting \(module\.config\.ts\) and an environment value/);
});

// ── the app config and what core reads ───────────────────────────────────

test("app.config receives the values and the deployment, and wires config.server.port", async () => {
  vi.stubEnv("PROBE_TOKEN", "x");
  vi.stubEnv("PROBE_PORT", "0");
  const app = await probeApp({
    "config/app.config.js": `export default (env, meta) => ({ server: { port: env.probe.port }, seen: { appEnv: meta.appEnv, mode: meta.mode, level: env.probe.level } });`,
  });

  // No boot({ port }) here: the listener takes what app.config wired.
  const handle = await app.boot({ port: undefined });
  expect(handle.ctx.config.seen).toEqual({ appEnv: "production", mode: "backend", level: "low" });
  expect(handle.ctx.config.server).toEqual({ port: 0 });
  expect(url(handle)).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  await handle.shutdown();

  // boot({ port }) wins over the wired value.
  const chosen = await app.boot({ port: 0 });
  expect(url(chosen)).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
});

test.each([
  ["a string", `'3000'`, /config\.server\.port must be a whole number between 0 and 65535, got "3000"/],
  ["a fraction", `80.5`, /got 80\.5/],
  ["out of range", `70000`, /got 70000/],
])("a port that is %s is refused by name", async (_label, port, message) => {
  const app = await fixture({ "config/app.config.js": `export default () => ({ server: { port: ${port} } });` });
  await expect(app.boot({ port: undefined })).rejects.toThrow(message);
});

test("app.config may not claim a module's namespace, and sees undefined where inspection has no value", async () => {
  const claiming = await fixture({ "config/app.config.js": `export default () => ({ probe: { port: 1 } });` });
  await expect(claiming.boot({ mode: "script" })).rejects.toThrow(/app\.config returns "probe", which is the config namespace of module "probe"/);

  vi.stubEnv("PROBE_TOKEN", undefined);
  const inspected = await (await probeApp({
    "config/app.config.js": `export default (env) => ({ seen: { token: env.probe.token, port: env.probe.port } });`,
  })).boot({ inspect: true });
  expect(inspected.ctx.config.seen).toEqual({ token: undefined, port: 0 });
});
