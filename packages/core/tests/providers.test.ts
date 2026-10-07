import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
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
    contract: ${JSON.stringify(options.contract ?? 2)},
    capability: ${JSON.stringify(options.capability ?? "models")},
    name: 'fake',
    async acquire({ ctx, files }, report, own) {
      log('acquire mode=' + ctx.mode + ' config=' + JSON.stringify(ctx.config) + ' modules=' + files.map(f => f.module.name).join(','));
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
      import { defineConfig } from '@tulipes/core/config';
      import { z } from 'zod/v4';
      export default defineConfig({ schema: z.object({ seen: z.boolean().default(false) }) });
    `,
    "modules/probe/bootstrap/probe.bootstrap.js": `
      import { appendFileSync } from 'node:fs';
      export default (ctx) => appendFileSync(new URL('../../../providers/log.txt', import.meta.url), 'bootstrap models=' + (ctx.models ? 'available' : 'missing') + ' seen=' + ctx.config.probe.seen + '\\n');
    `,
  });

  const handle = await app.boot({ mode: "script" });
  const models = handle.ctx.models as unknown as { get(name: string): string };

  expect(models.get("User")).toBe("model:User");
  // Config factories run before acquisition: the slot is not there yet.
  // The provider was acquired before any namespace loaded; bootstrap saw both.
  expect(handle.ctx.config.probe).toEqual({ seen: false });
  expect(handle.providers).toEqual([{ capability: "models", provider: "fake", label: "fake://script", ready: true }]);
  expect(await readLog(app.rootDir)).toEqual(["acquire mode=script config={} modules=probe", "bootstrap models=available seen=false"]);

  await handle.shutdown();

  expect(await readLog(app.rootDir)).toEqual(["acquire mode=script config={} modules=probe", "bootstrap models=available seen=false", "dispose"]);
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

test("a models/ directory implies the models requirement", async () => {
  const app = await fixture({ "modules/probe/models/user.model.js": `throw new Error('model code imported');` });

  await expect(app.boot({ mode: "script" })).rejects.toThrow(/\[probe\] requires capability "models" \(has models\/ files\)/);
});

test("an installed but undeclared provider is never imported, even with MONGO_URI set", async () => {
  const app = await fixture({
    "providers/fake.js": `throw new Error('provider imported without a declaration');`,
    "modules/probe/package.json": JSON.stringify({ name: "@test/probe", type: "module", tulipes: { env: [
        { name: "PORT", type: "number", default: 0, description: "Ephemeral HTTP port" },
        { name: "MONGO_URI", type: "url", default: "mongodb://127.0.0.1:1/unused", description: "Leftover" },
      ] } }),
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
    [{ contract: 1 }, /implements provider contract 1; this core supports 2/],
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

test("inspection validates declarations without resolving or importing the provider", async () => {
  const declaredButAbsent = await fixture({
    "package.json": declare({ models: "@tulipes/not-installed-anywhere" }),
    "modules/probe/package.json": JSON.stringify({ name: "@test/probe", type: "module", tulipes: { requires: ["models"] } }),
    "modules/probe/module.acl.js": `export default acl => acl.defineRole('guest');`,
  });

  const inspected = await declaredButAbsent.boot({ inspect: true });
  expect(inspected.providers).toEqual([expect.objectContaining({ capability: "models", provider: "@tulipes/not-installed-anywhere", skipped: "inspect" })]);
  expect(() => (inspected.ctx.models as { get(name: string): unknown }).get("User")).toThrow(/ctx\.models is not available during inspection/);
  await inspected.shutdown();

  const unmet = await fixture({
    "modules/probe/package.json": JSON.stringify({ name: "@test/probe", type: "module", tulipes: { requires: ["models"] } }),
    "modules/probe/module.acl.js": `export default acl => acl.defineRole('guest');`,
  });

  await expect(unmet.boot({ inspect: true })).rejects.toThrow(/\[probe\] requires capability "models"/);
});

/** A provider whose resource can serve and drain, logging the order of events. */
const servingProvider = (options: { consumers?: number; serve?: boolean } = {}) => `
  import { appendFileSync } from 'node:fs';
  const log = line => appendFileSync(new URL('./log.txt', import.meta.url), line + '\\n');
  export default {
    contract: 2, capability: 'queues', name: 'fake-queues',
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

test("ctx.signal aborts and drain() runs before bootstrap cleanups, and dispose() after them, in one shutdown", async () => {
  const app = await fixture({
    "package.json": declare({ queues: "./providers/queues.js" }),
    "providers/queues.js": servingProvider(),
    "modules/probe/package.json": JSON.stringify({ name: "@test/probe", type: "module", tulipes: { requires: ["queues"] } }),
    "modules/probe/bootstrap/probe.bootstrap.js": `
      import { appendFileSync } from 'node:fs';
      const log = line => appendFileSync(new URL('../../../providers/log.txt', import.meta.url), line + '\\n');
      export default (ctx) => {
        ctx.signal.addEventListener('abort', () => log('module abort'));
        return () => log('module cleanup queues=' + (ctx.queues ? 'available' : 'gone'));
      };
    `,
  });

  const handle = await app.boot({ mode: "script" });
  await handle.shutdown();

  const log = await readLog(app.rootDir);
  // The abort and the provider drain both precede the cleanup, which precedes dispose.
  expect(log.slice(0, 2).sort()).toEqual(["drain", "module abort"]);
  expect(log.slice(2)).toEqual(["module cleanup queues=available", "dispose"]);
});

test("a queues/ directory implies the queues requirement", async () => {
  const app = await fixture({ "modules/probe/queues/work.queues.js": `throw new Error('queue code imported');` });

  await expect(app.boot({ mode: "script" })).rejects.toThrow(/\[probe\] requires capability "queues" \(has queues\/ files\)/);
});

/** A backend-only transport provider: attaches to the HTTP server before listen. */
const transportProvider = `
  import { appendFileSync } from 'node:fs';
  const log = line => appendFileSync(new URL('./log.txt', import.meta.url), line + '\\n');
  export default {
    contract: 2, capability: 'sockets', name: 'fake-sockets', situations: ['backend'],
    async acquire({ ctx, situation }, report, own) {
      log('acquire situation=' + situation);
      own({
        attach: server => log('attach listening=' + server.listening),
        drain: () => log('drain'),
        dispose: () => log('dispose'),
        status: () => ({ label: '/probe', ready: true }),
      });
      return { of: () => 'namespace' };
    },
  };
`;

test("a backend-only provider attaches before listen and is skipped elsewhere without failing", async () => {
  const app = await fixture({
    "package.json": declare({ sockets: "./providers/sockets.js" }),
    "providers/sockets.js": transportProvider,
    "modules/probe/package.json": JSON.stringify({ name: "@test/probe", type: "module", tulipes: { requires: ["sockets"] } }),
  });

  const backend = await app.boot();
  expect(backend.ctx.sockets).toBeDefined();
  expect(backend.providers).toEqual([expect.objectContaining({ capability: "sockets", label: "/probe", ready: true })]);
  expect(await readLog(app.rootDir)).toEqual(["acquire situation=backend", "attach listening=false"]);
  await backend.shutdown();
  expect(await readLog(app.rootDir)).toEqual(["acquire situation=backend", "attach listening=false", "drain", "dispose"]);

  for (const [options, situation] of [[{ mode: "worker" as const }, "worker"], [{ mode: "script" as const }, "script"], [{ inspect: true }, "inspect"]] as const) {
    const before = (await readLog(app.rootDir)).length;
    const handle = options.mode === "worker"
      ? await app.boot({ ...options, listen: false }).catch((error: Error) => error)
      : await app.boot(options);
    // Worker mode refuses for lack of consumers, but the skipped provider is not the reason.
    if (handle instanceof Error) expect(handle.message).toMatch(/zero processors/);
    else {
      // Inspection hands out a stub that throws on use; the other modes hand out nothing.
      if (situation === "inspect") expect(() => (handle.ctx.sockets as { of(name: string): unknown }).of("/probe")).toThrow(/not available during inspection/);
      else expect(handle.ctx.sockets).toBeUndefined();
      expect(handle.providers).toEqual([expect.objectContaining({ capability: "sockets", skipped: situation, ready: true })]);
      await handle.shutdown();
    }
    expect((await readLog(app.rootDir)).length).toBe(before); // never acquired, attached or disposed
  }
});

test("an attach failure is reported as a provider issue and the acquired resource is disposed", async () => {
  const app = await fixture({
    "package.json": declare({ sockets: "./providers/sockets.js" }),
    "providers/sockets.js": transportProvider.replace("attach: server => log('attach listening=' + server.listening)", "attach: () => { throw new Error('port busy'); }"),
  });

  await expect(app.boot()).rejects.toThrow(/provider "fake-sockets" failed to attach to the HTTP server: port busy/);
  expect(await readLog(app.rootDir)).toEqual(["acquire situation=backend", "drain", "dispose"]);
});

test("a sockets/ directory implies the sockets requirement", async () => {
  const app = await fixture({ "modules/probe/sockets/live.sockets.js": `throw new Error('socket code imported');` });

  await expect(app.boot({ mode: "script" })).rejects.toThrow(/\[probe\] requires capability "sockets" \(has sockets\/ files\)/);
});

test("a declared settings provider's store is what the manager loads, writes and watches, and it never lands on ctx", async () => {
  const app = await fixture({
    "package.json": declare({ settings: "./providers/store.js" }),
    "providers/store.js": `
      import { appendFileSync } from 'node:fs';
      import { MemorySettingsStore } from '@tulipes/core/config';
      const log = line => appendFileSync(new URL('./log.txt', import.meta.url), line + '\\n');
      class Store extends MemorySettingsStore {
        constructor() { super('fake store'); }
        async save(namespace, values, expectedVersion, actor) { log('save ' + namespace + ' v' + expectedVersion + ' by ' + actor.id); return super.save(namespace, values, expectedVersion, actor); }
        watch(listener) { globalThis.__push = (namespace, stored) => listener(namespace, stored); return () => log('unwatch'); }
      }
      export default {
        contract: 2, capability: 'settings', name: 'fake-store',
        async acquire({ ctx }, report, own) {
          log('acquire models=' + (ctx.models ? 'present' : 'absent'));
          own({ dispose: () => log('dispose'), status: () => ({ label: 'fake store', ready: true }) });
          return new Store();
        },
      };
    `,
    "modules/probe/package.json": JSON.stringify({ name: "@test/probe", type: "module" }),
    "modules/probe/module.config.js": `
      import { defineConfig } from '@tulipes/core/config';
      import { z } from 'zod/v4';
      export default defineConfig({ schema: z.object({ greeting: z.string().default('Hello') }) });
    `,
  });

  const handle = await app.boot({ mode: "script" });
  try {
    // ctx.settings is core's manager; the provider's store sits behind it.
    expect(handle.ctx.settings.status()).toEqual({ label: "fake store", ready: true });
    expect(handle.providers).toEqual([{ capability: "settings", provider: "fake-store", label: "fake store", ready: true }]);
    expect(handle.ctx.config.probe).toEqual({ greeting: "Hello" });

    await handle.ctx.settings.set("probe", { greeting: "Hi" }, { id: "operator" });
    expect(handle.ctx.config.probe).toEqual({ greeting: "Hi" });

    (globalThis as unknown as { __push: (namespace: string, stored: unknown) => void }).__push("probe", { values: { greeting: "Elsewhere" }, version: 3, updated_at: "now", updated_by: { id: "other" } });
    await expect.poll(() => handle.ctx.config.probe).toEqual({ greeting: "Elsewhere" });
  } finally {
    await handle.shutdown();
  }
  expect(await readLog(app.rootDir)).toEqual(["acquire models=absent", "save probe v0 by system", "save probe v1 by operator", "unwatch", "dispose"]);
  // No file store was used: the declaration replaced it.
  await expect(readFile(join(app.rootDir, "config/settings.development.json"), "utf8")).rejects.toThrow();
});
