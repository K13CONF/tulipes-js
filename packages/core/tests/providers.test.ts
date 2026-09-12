import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { inspectRoutes } from "../src/boot/inspect.js";
import { fixture } from "./fixture.js";

/**
 * The provider seam, exercised with a fake provider written into the app —
 * no driver, no services. What is asserted is observable behavior: what the
 * app declared, what got imported, what ctx exposes, what got disposed.
 */

const declare = (providers: Record<string, string>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "module", tulipes: { providers, ...extra } });

/** A provider that records its lifecycle into a file the test can read back. */
const fakeProvider = (options: { fail?: "report" | "throw" | "silent"; ownTwice?: boolean; contract?: unknown; capability?: string } = {}) => `
  import { appendFileSync } from 'node:fs';
  const log = line => appendFileSync(new URL('./log.txt', import.meta.url), line + '\\n');
  export default {
    contract: ${JSON.stringify(options.contract ?? 1)},
    capability: ${JSON.stringify(options.capability ?? "models")},
    name: 'fake',
    async acquire({ ctx, files, runBootstrap }, report, own) {
      log('acquire mode=' + ctx.mode + ' bootstrap=' + runBootstrap + ' modules=' + files.map(f => f.module.name).join(','));
      const resource = { dispose: () => log('dispose'), forceDispose: () => log('force'), status: () => ({ label: 'fake://' + ctx.mode, ready: true }) };
      own(resource);
      ${options.ownTwice ? "own(resource);" : ""}
      await new Promise(resolve => setTimeout(resolve, 5));
      ${options.fail === "report" ? "report.add({ scope: 'providers', message: 'fake could not connect' }); return undefined;" : ""}
      ${options.fail === "throw" ? "throw new Error('fake exploded');" : ""}
      ${options.fail === "silent" ? "return undefined;" : ""}
      return { get: name => 'model:' + name, id: Math.random() };
    },
  };
`;

const readLog = (rootDir: string) => readFile(join(rootDir, "providers/log.txt"), "utf8").then((s) => s.trim().split("\n"), () => []);

test("a declared provider is acquired once, exposed on ctx and disposed on shutdown", async () => {
  const app = await fixture({
    "package.json": declare({ models: "./providers/fake.js" }),
    "providers/fake.js": fakeProvider(),
    "modules/probe/package.json": JSON.stringify({ name: "@test/probe", type: "module", tulipes: { requires: ["models"] } }),
    "modules/probe/module.config.js": `
      export default (ctx) => ({ seen: ctx.models === undefined });
    `,
  });

  const handle = await app.boot({ mode: "script" });
  const models = handle.ctx.models as unknown as { get(name: string): string };

  expect(models.get("User")).toBe("model:User");
  // Config factories run before acquisition: the slot is not there yet.
  expect(handle.ctx.config.probe).toEqual({ seen: true });
  expect(handle.providers).toEqual([{ capability: "models", provider: "fake", label: "fake://script", ready: true }]);
  expect(await readLog(app.rootDir)).toEqual(["acquire mode=script bootstrap=false modules=probe"]);

  await handle.shutdown();

  expect(await readLog(app.rootDir)).toEqual(["acquire mode=script bootstrap=false modules=probe", "dispose"]);
});

test("a module that requires models is refused before any module code is imported", async () => {
  const app = await fixture({
    "modules/probe/package.json": JSON.stringify({ name: "@test/probe", type: "module", tulipes: { requires: ["models"] } }),
    "modules/probe/module.config.js": `throw new Error('module code imported');`,
  });

  await expect(app.boot({ mode: "script" })).rejects.toThrow(
    /\[probe\] requires capability "models" \(declares it in tulipes\.requires\) but the app's package\.json declares no provider/,
  );
});

test("models/ and bootstrap/ directories imply the models requirement", async () => {
  for (const file of ["modules/probe/models/user.model.js", "modules/probe/bootstrap/seed.bootstrap.js"]) {
    const app = await fixture({ [file]: `throw new Error('model code imported');` });

    await expect(app.boot({ mode: "script" })).rejects.toThrow(
      new RegExp(`\\[probe\\] requires capability "models" \\(has ${file.includes("models/") ? "models" : "bootstrap"}/ files\\)`),
    );
  }
});

test("an installed but undeclared provider is never imported, even with MONGO_URI set", async () => {
  const app = await fixture({
    "providers/fake.js": `throw new Error('provider imported without a declaration');`,
    "modules/probe/meta.variables.json": JSON.stringify({
      variables: [
        { name: "PORT", type: "number", default: 0, description: "Ephemeral HTTP port" },
        { name: "MONGO_URI", type: "url", default: "mongodb://127.0.0.1:1/unused", description: "Leftover" },
      ],
    }),
  });

  const handle = await app.boot({ mode: "script" });

  expect(handle.ctx.models).toBeUndefined();
  expect(handle.providers).toEqual([]);
});

test("a provider that fails after owning its resource is still disposed and the boot reports why", async () => {
  for (const [fail, message] of [
    ["report", /fake could not connect/],
    ["throw", /provider "fake" threw during acquisition: fake exploded/],
    ["silent", /provider "fake" returned nothing without reporting why/],
  ] as const) {
    const app = await fixture({
      "package.json": declare({ models: "./providers/fake.js" }),
      "providers/fake.js": fakeProvider({ fail }),
    });

    await expect(app.boot({ mode: "script" })).rejects.toThrow(message);

    expect(await readLog(app.rootDir)).toEqual([expect.stringMatching(/^acquire/), "dispose"]);
  }
});

test("owning twice, a foreign contract or a mismatched capability are provider errors", async () => {
  const cases: [Parameters<typeof fakeProvider>[0], RegExp][] = [
    [{ ownTwice: true }, /called own\(\) twice/],
    [{ contract: 2 }, /implements provider contract 2; this core supports 1/],
    [{ capability: "queues" }, /provides capability "queues" but is declared for "models"/],
  ];
  for (const [options, message] of cases) {
    const app = await fixture({
      "package.json": declare({ models: "./providers/fake.js" }),
      "providers/fake.js": fakeProvider(options),
    });

    await expect(app.boot({ mode: "script" })).rejects.toThrow(message);
  }
});

test("a declared provider that cannot be resolved or has the wrong shape is reported, not thrown bare", async () => {
  const missing = await fixture({ "package.json": declare({ models: "@tulipes/does-not-exist" }) });

  await expect(missing.boot({ mode: "script" })).rejects.toThrow(
    /provider "@tulipes\/does-not-exist" for capability "models" cannot be resolved from .* — install it/,
  );

  const malformed = await fixture({
    "package.json": declare({ models: "./providers/fake.js" }),
    "providers/fake.js": `export default { name: 'fake' };`,
  });

  await expect(malformed.boot({ mode: "script" })).rejects.toThrow(/must default-export a provider \{ contract, capability, name, acquire \}/);
});

test("two boots own two separate acquisitions and dispose independently", async () => {
  const app = await fixture({
    "package.json": declare({ models: "./providers/fake.js" }),
    "providers/fake.js": fakeProvider(),
  });

  const first = await app.boot({ mode: "script" });
  const second = await app.boot({ mode: "script" });
  const id = (handle: typeof first) => (handle.ctx.models as unknown as { id: number }).id;

  expect(id(first)).not.toBe(id(second));

  await first.shutdown();

  expect((await readLog(app.rootDir)).filter((line) => line === "dispose")).toHaveLength(1);
  expect(id(second)).toBeDefined();

  await second.shutdown();

  expect((await readLog(app.rootDir)).filter((line) => line === "dispose")).toHaveLength(2);
});

test("declaration typos fail closed in both the app manifest and a module manifest", async () => {
  const app = await fixture({ "package.json": declare({ modles: "./providers/fake.js" }) });

  await expect(app.boot({ mode: "script" })).rejects.toThrow(/package\.json "tulipes" key: providers — Unrecognized key/);

  const module = await fixture({
    "modules/probe/package.json": JSON.stringify({ name: "@test/probe", type: "module", tulipes: { requires: ["modles"] } }),
  });

  await expect(module.boot({ mode: "script" })).rejects.toThrow(/\[probe\] package\.json "tulipes" key: requires\.0 — /);
});

test("offline inspection validates declarations without resolving or importing the provider", async () => {
  const declaredButAbsent = await fixture({
    "package.json": declare({ models: "@tulipes/not-installed-anywhere" }),
    "modules/probe/package.json": JSON.stringify({ name: "@test/probe", type: "module", tulipes: { offline: true, requires: ["models"] } }),
    "modules/probe/module.acl.js": `export default acl => acl.defineRole('guest');`,
  });

  await expect(inspectRoutes({ rootDir: declaredButAbsent.rootDir })).resolves.toMatchObject({ routes: expect.anything() });

  const unmet = await fixture({
    "modules/probe/package.json": JSON.stringify({ name: "@test/probe", type: "module", tulipes: { offline: true, requires: ["models"] } }),
    "modules/probe/module.acl.js": `export default acl => acl.defineRole('guest');`,
  });

  await expect(inspectRoutes({ rootDir: unmet.rootDir })).rejects.toThrow(/\[probe\] requires capability "models"/);
});

/** A provider whose resource can serve and drain, logging the order of events. */
const servingProvider = (options: { consumers?: number; serve?: boolean } = {}) => `
  import { appendFileSync } from 'node:fs';
  const log = line => appendFileSync(new URL('./log.txt', import.meta.url), line + '\\n');
  export default {
    contract: 1, capability: 'queues', name: 'fake-queues',
    async acquire({ ctx }, report, own) {
      own({
        ${options.serve === false ? "" : `serve: () => { log('serve mode=' + ctx.mode); return ${options.consumers ?? 1}; },`}
        drain: async () => { await new Promise(r => setTimeout(r, 5)); log('drain'); },
        dispose: () => log('dispose'),
        status: () => ({ label: 'fake-queues', ready: true, detail: 'x' }),
      });
      return { produce: () => 'ok' };
    },
  };
`;

test("serve() runs in worker mode only and its count gates the worker", async () => {
  const app = await fixture({
    "package.json": declare({ queues: "./providers/queues.js" }),
    "providers/queues.js": servingProvider({ consumers: 2 }),
  });

  const backend = await app.boot({ listen: false });
  expect(backend.consumers).toBe(0);
  expect(await readLog(app.rootDir)).toEqual([]);
  await backend.shutdown();

  const worker = await app.boot({ mode: "worker" });
  expect(worker.consumers).toBe(2);
  expect(await readLog(app.rootDir)).toEqual(["drain", "dispose", "serve mode=worker"]);
  await worker.shutdown();

  const idle = await fixture({
    "package.json": declare({ queues: "./providers/queues.js" }),
    "providers/queues.js": servingProvider({ consumers: 0 }),
  });
  await expect(idle.boot({ mode: "worker" })).rejects.toThrow(/worker mode started with zero processors/);

  const cannotServe = await fixture({
    "package.json": declare({ queues: "./providers/queues.js" }),
    "providers/queues.js": servingProvider({ serve: false }),
  });
  await expect(cannotServe.boot({ mode: "worker" })).rejects.toThrow(/zero processors/);
  // The refusal still disposed what was acquired.
  expect(await readLog(cannotServe.rootDir)).toEqual(["drain", "dispose"]);
});

test("drain() runs before module onShutdown and dispose() after it, in one shutdown", async () => {
  const app = await fixture({
    "package.json": declare({ queues: "./providers/queues.js" }),
    "providers/queues.js": servingProvider(),
    "modules/probe/package.json": JSON.stringify({ name: "@test/probe", type: "module", tulipes: { requires: ["queues"] } }),
    "modules/probe/module.config.js": `
      import { appendFileSync } from 'node:fs';
      const log = line => appendFileSync(new URL('../../providers/log.txt', import.meta.url), line + '\\n');
      export default () => ({});
      export function onDrain() { log('module onDrain'); }
      export function onShutdown(ctx) { log('module onShutdown queues=' + (ctx.queues ? 'available' : 'gone')); }
    `,
  });

  const handle = await app.boot({ mode: "script" });
  await handle.shutdown();

  const log = await readLog(app.rootDir);
  // onDrain and drain run concurrently; both precede onShutdown, which precedes dispose.
  expect(log.slice(0, 2).sort()).toEqual(["drain", "module onDrain"]);
  expect(log.slice(2)).toEqual(["module onShutdown queues=available", "dispose"]);
});

test("a queues/ directory implies the queues requirement", async () => {
  const app = await fixture({ "modules/probe/queues/work.queues.js": `throw new Error('queue code imported');` });

  await expect(app.boot({ mode: "script" })).rejects.toThrow(/\[probe\] requires capability "queues" \(has queues\/ files\)/);
});
