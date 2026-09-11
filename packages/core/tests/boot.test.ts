import { expect, test } from "vitest";
import { fixture } from "./fixture.js";

test("shutdown runs module cleanup only once, including concurrent calls", async () => {
  const app = await fixture({
    "modules/probe/module.config.js": `
      export default () => ({ calls: 0 });
      export async function onShutdown(ctx) { ctx.config.probe.calls++; }
    `,
  });

  const handle = await app.boot({ mode: "script" });
  const first = handle.shutdown();

  expect(handle.shutdown()).toBe(first);

  await first;

  await handle.shutdown();

  expect(handle.ctx.config.probe).toEqual({ calls: 1 });
});

test("drains active requests before disposing module resources", async () => {
  const app = await fixture({
    "modules/probe/module.config.js": `
      export default () => ({ closed: false, started: false });
      export function onShutdown(ctx) { ctx.config.probe.closed = true; }
    `,
    "modules/probe/module.acl.js": `export default acl => acl.defineRole('guest').allow('guest', 'probe:read');`,
    "modules/probe/routes/probe.routes.js": `
      import { Router } from 'express';
      export default ctx => {
        const r = Router();
        r.get('/slow', ctx.rai({ id: 'probe:read' }), async (req, res) => {
          ctx.config.probe.started = true;
          await new Promise(resolve => { ctx.config.probe.release = resolve; });
          res.respond({ data: { closed: ctx.config.probe.closed } });
        });
        return r;
      };
    `,
  });

  const handle = await app.boot();
  const { url } = await import("./fixture.js");

  const state = handle.ctx.config.probe as {
    started: boolean;
    release: () => void;
  };

  const response = fetch(url(handle) + "/slow", {
    headers: { connection: "close" },
  });

  await expect.poll(() => state.started).toBe(true);

  const shutdown = handle.shutdown();

  state.release();

  expect(await (await response).json()).toMatchObject({
    data: { closed: false },
  });

  await shutdown;
});

test("cleans up configured modules when a later boot phase fails", async () => {
  const { readFile } = await import("node:fs/promises");
  const app = await fixture();
  const marker = JSON.stringify(app.rootDir + "/closed");

  await app.write(
    "modules/probe/module.config.js",
    `
    import { writeFileSync } from 'node:fs';
    export default () => ({});
    export function onShutdown() { writeFileSync(${marker}, 'closed'); }
  `,
  );

  await app.write(
    "modules/probe/routes/probe.routes.js",
    `export default () => { throw new Error('route failed'); };`,
  );

  await expect(app.boot()).rejects.toThrow(/route failed/);

  expect(await readFile(app.rootDir + "/closed", "utf8")).toBe("closed");
});

test("bounds a stuck cleanup hook and still attempts later cleanup", async () => {
  const app = await fixture({
    "modules/probe/module.config.js": `
      export default () => ({ closed: false });
      export function onShutdown(ctx) { ctx.config.probe.closed = true; }
    `,
    "modules/stuck/package.json":
      '{"name":"@test/stuck","type":"module","tulipes":{"dependsOn":["probe"]}}',
    "modules/stuck/module.config.js": `
      export default () => ({});
      export function onShutdown() { return new Promise(() => {}); }
    `,
  });

  const handle = await app.boot({ mode: "script", shutdownTimeoutMs: 100 });

  await expect(handle.shutdown()).rejects.toThrow(/timed out/);

  expect(handle.ctx.config.probe).toEqual({ closed: true });
});

test("capability accessors reject missing infrastructure and preserve available services", async () => {
  const { requireModels, requireQueues } = await import("../src/boot/index.js");
  const { ModelStore } = await import("../src/db/model-store.js");
  const { QueueManager } = await import("../src/queues/queue-manager.js");

  expect(() => requireModels({})).toThrow(/requires a database/);
  expect(() => requireQueues({})).toThrow(/requires a queue/);

  const models = new ModelStore(),
    queues = new QueueManager("redis://127.0.0.1:1");

  expect(requireModels({ models })).toBe(models);
  expect(requireQueues({ queues })).toBe(queues);
});

test("removes its signal listeners on explicit shutdown", async () => {
  const before = [
    process.listenerCount("SIGTERM"),
    process.listenerCount("SIGINT"),
  ];

  const app = await fixture();
  const handle = await app.boot({ mode: "script", handleSignals: true });

  await handle.shutdown();

  expect([
    process.listenerCount("SIGTERM"),
    process.listenerCount("SIGINT"),
  ]).toEqual(before);
});

test("preserves the startup failure when cleanup also fails", async () => {
  const app = await fixture({
    "modules/probe/module.config.js": `
      export default () => ({});
      export function onReady() { throw new Error('startup marker'); }
      export function onShutdown() { throw new Error('cleanup marker'); }
    `,
  });

  await expect(app.boot()).rejects.toMatchObject({
    cause: { message: expect.stringContaining("startup marker") },
    errors: [
      expect.objectContaining({
        message: expect.stringContaining("startup marker"),
      }),
      expect.objectContaining({
        message: expect.stringContaining("cleanup marker"),
      }),
    ],
  });
});

test("attempts remaining module cleanup after a hook throws", async () => {
  const app = await fixture({
    "modules/probe/module.config.js": `
      export default () => ({ closed: false });
      export function onShutdown(ctx) { ctx.config.probe.closed = true; }
    `,
    "modules/failed/package.json":
      '{"name":"@test/failed","type":"module","tulipes":{"dependsOn":["probe"]}}',
    "modules/failed/module.config.js": `
      export default () => ({});
      export function onShutdown() { throw new Error('intentional failure'); }
    `,
  });

  const handle = await app.boot({ mode: "script" });

  await expect(handle.shutdown()).rejects.toThrow(/intentional failure/);

  expect(handle.ctx.config.probe).toEqual({ closed: true });
});

test("onDrain closes an idle SSE before HTTP waits while ordinary requests keep their resources", async () => {
  const app = await fixture({
    "modules/probe/module.config.js": `
      export default () => ({ closed: false, drains: 0, started: false });
      export function onDrain(ctx) { ctx.config.probe.drains++; ctx.config.probe.stream?.end(); }
      export function onShutdown(ctx) { ctx.config.probe.closed = true; }
    `,
    "modules/probe/module.acl.js": `export default acl => acl.defineRole('guest').allow('guest', 'probe:read', 'probe:stream');`,
    "modules/probe/routes/probe.routes.js": `
      import { Router } from 'express';
      export default ctx => {
        const r = Router();
        r.get('/stream', ctx.rai({ id: 'probe:stream' }), (req, res) => {
          ctx.config.probe.stream = res;
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write('event: ready\\ndata: {}\\n\\n');
        });
        r.get('/slow', ctx.rai({ id: 'probe:read' }), async (req, res) => {
          ctx.config.probe.started = true;
          await new Promise(resolve => { ctx.config.probe.release = resolve; });
          res.respond({ data: { closed: ctx.config.probe.closed } });
        });
        return r;
      };
    `,
  });

  const handle = await app.boot({ shutdownTimeoutMs: 500 });
  const { url } = await import("./fixture.js");
  const base = url(handle);

  const state = handle.ctx.config.probe as {
    drains: number;
    started: boolean;
    closed: boolean;
    release: () => void;
  };

  const stream = await fetch(base + "/stream");
  const body = stream.text();

  // Handle the old implementation's forced close without an unhandled rejection.
  void body.catch(() => {});

  const slow = fetch(base + "/slow", { headers: { connection: "close" } });

  await expect.poll(() => state.started).toBe(true);

  const pending = handle.shutdown();

  expect(handle.shutdown()).toBe(pending);

  state.release();

  expect(await (await slow).json()).toMatchObject({ data: { closed: false } });

  await expect(pending).resolves.toBeUndefined();

  expect(await body).toContain("event: ready");
  expect(state).toMatchObject({ drains: 1, closed: true });
});

test("drain failures share the deadline, aggregate errors and preserve later cleanup", async () => {
  const app = await fixture({
    "modules/probe/module.config.js": `
      export default () => ({ calls: [] });
      export function onDrain(ctx) { ctx.config.probe.calls.push('probe drain'); throw new Error('drain marker'); }
      export function onShutdown(ctx) { ctx.config.probe.calls.push('probe close'); }
    `,
    "modules/stuck/package.json":
      '{"name":"@test/stuck","type":"module","tulipes":{"dependsOn":["probe"]}}',
    "modules/stuck/module.config.js": `
      export default () => ({});
      export function onDrain(ctx) { ctx.config.probe.calls.push('stuck drain'); return new Promise(() => {}); }
      export function onShutdown(ctx) { ctx.config.probe.calls.push('stuck close'); }
    `,
  });

  const handle = await app.boot({ shutdownTimeoutMs: 250 });
  const started = performance.now();
  const stopping = handle.shutdown();

  void stopping.catch(() => {});

  // A stuck drain notification must not keep the HTTP listener accepting work.
  await expect.poll(() => handle.server!.listening).toBe(false);

  await expect(stopping).rejects.toMatchObject({
    errors: expect.arrayContaining([
      expect.objectContaining({
        message: expect.stringContaining("probe onDrain: drain marker"),
      }),
      expect.objectContaining({
        message: expect.stringContaining(
          "stuck onDrain: stuck onDrain timed out",
        ),
      }),
    ]),
  });

  expect(performance.now() - started).toBeLessThan(1000);

  expect(handle.ctx.config.probe).toEqual({
    calls: ["stuck drain", "probe drain", "stuck close", "probe close"],
  });
});

test("onDrain is validated and runs during failed startup before module disposal", async () => {
  const { readFile } = await import("node:fs/promises");
  const app = await fixture();
  const marker = JSON.stringify(app.rootDir + "/drain-order");

  await app.write(
    "modules/probe/module.config.js",
    `
    import { appendFileSync } from 'node:fs';
    export default () => ({});
    export function onDrain() { appendFileSync(${marker}, 'drain '); }
    export function onShutdown() { appendFileSync(${marker}, 'close'); }
  `,
  );

  await app.write(
    "modules/probe/routes/probe.routes.js",
    `export default () => { throw new Error('route marker'); };`,
  );

  await expect(app.boot()).rejects.toThrow(/route marker/);

  expect(await readFile(app.rootDir + "/drain-order", "utf8")).toBe(
    "drain close",
  );

  const invalid = await fixture({
    "modules/probe/module.config.js": `export default () => ({}); export const onDrain = 42;`,
  });

  await expect(invalid.boot({ mode: "script" })).rejects.toThrow(
    /onDrain.*must be a function/,
  );
});

test("a module can export only onDrain and reentrant shutdown shares the same operation", async () => {
  const app = await fixture({
    "modules/probe/module.config.js": `
      export default () => ({ calls: 0 });
      export function onDrain(ctx) {
        ctx.config.probe.calls++;
        ctx.config.probe.reentrant = ctx.config.probe.shutdown();
      }
    `,
  });

  const handle = await app.boot({ mode: "script" });

  const state = handle.ctx.config.probe as {
    shutdown: () => Promise<void>;
    calls: number;
    reentrant?: Promise<void>;
  };

  state.shutdown = handle.shutdown;

  const stopping = handle.shutdown();

  await stopping;

  expect(state.calls).toBe(1);
  expect(state.reentrant).toBe(stopping);
});
