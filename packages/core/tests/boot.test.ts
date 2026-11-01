import { expect, test, vi } from "vitest";
import { fixture, url } from "./fixture.ts";

/**
 * Lifecycle: a bootstrap file is the one place a module initializes, and
 * the cleanup it returns is the one place it closes what it opened. Tests
 * share state with fixture code through globalThis, since both run in this
 * process.
 */
type Probe = Record<string, unknown>;
const probe = (initial: Probe = {}): Probe => ((globalThis as { __probe?: Probe }).__probe = initial);
const bootstrap = (body: string) => `const state = globalThis.__probe;\nexport default (ctx) => { ${body} };`;

test("shutdown runs a bootstrap cleanup only once, including concurrent calls", async () => {
  const state = probe({ calls: 0 });
  const app = await fixture({
    "modules/probe/bootstrap/probe.bootstrap.js": bootstrap(`return () => { state.calls++; };`),
  });

  const handle = await app.boot({ mode: "script" });
  const first = handle.shutdown();

  expect(handle.shutdown()).toBe(first);

  await first;

  await handle.shutdown();

  expect(state.calls).toBe(1);
});

test("drains active requests before running bootstrap cleanups", async () => {
  const state = probe({ closed: false, started: false });
  const app = await fixture({
    "modules/probe/bootstrap/probe.bootstrap.js": bootstrap(`return () => { state.closed = true; };`),
    "modules/probe/module.acl.js": `export default acl => acl.defineRole('guest').allow('guest', 'probe:web:read');`,
    "modules/probe/routes/probe.routes.js": `
      import { Router } from 'express';
      const state = globalThis.__probe;
      export default ctx => {
        const r = Router();
        r.get('/slow', ctx.rai({ id: 'probe:web:read' }), async (req, res) => {
          state.started = true;
          await new Promise(resolve => { state.release = resolve; });
          res.respond({ data: { closed: state.closed } });
        });
        return r;
      };
    `,
  });

  const handle = await app.boot();

  const response = fetch(url(handle) + "/slow", { headers: { connection: "close" } });

  await expect.poll(() => state.started).toBe(true);

  const shutdown = handle.shutdown();

  (state.release as () => void)();

  expect(await (await response).json()).toMatchObject({ data: { closed: false } });

  await shutdown;
  expect(state.closed).toBe(true);
});

test("runs collected cleanups when a later boot phase fails", async () => {
  const { readFile } = await import("node:fs/promises");
  const app = await fixture();
  const marker = JSON.stringify(app.rootDir + "/closed");

  await app.write(
    "modules/probe/bootstrap/probe.bootstrap.js",
    `import { writeFileSync } from 'node:fs';\nexport default () => () => writeFileSync(${marker}, 'closed');`,
  );

  await app.write(
    "modules/probe/routes/probe.routes.js",
    `export default () => { throw new Error('route failed'); };`,
  );

  await expect(app.boot()).rejects.toThrow(/route failed/);

  expect(await readFile(app.rootDir + "/closed", "utf8")).toBe("closed");
});

test("bounds a stuck cleanup and still runs the ones before it", async () => {
  const state = probe({ closed: false });
  const app = await fixture({
    "modules/probe/bootstrap/probe.bootstrap.js": bootstrap(`return () => { state.closed = true; };`),
    "modules/stuck/package.json":
      '{"name":"@test/stuck","type":"module","tulipes":{"dependsOn":["probe"]}}',
    "modules/stuck/bootstrap/stuck.bootstrap.js": `export default () => () => new Promise(() => {});`,
  });

  const handle = await app.boot({ mode: "script", shutdownTimeoutMs: 100 });

  await expect(handle.shutdown()).rejects.toThrow(/timed out/);

  expect(state.closed).toBe(true);
});

test("capability accessors reject missing infrastructure and preserve available services", async () => {
  const { requireModels, requireQueues } = await import("../src/boot/index.ts");

  expect(() => requireModels({})).toThrow(/tulipes\.providers\.models/);
  expect(() => requireQueues({})).toThrow(/tulipes\.providers\.queues/);

  // Whatever the declared providers handed over: core only checks presence.
  const models = {} as import("../src/boot/index.ts").ModelsCapability,
    queues = {} as import("../src/boot/index.ts").QueuesCapability;

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

test("preserves the startup failure when a cleanup also fails", async () => {
  const app = await fixture({
    "modules/probe/bootstrap/probe.bootstrap.js": `export default () => () => { throw new Error('cleanup marker'); };`,
    "modules/probe/routes/probe.routes.js": `export default () => { throw new Error('startup marker'); };`,
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

test("attempts the remaining cleanups after one throws, in reverse load order", async () => {
  const state = probe({ closed: false });
  const app = await fixture({
    "modules/probe/bootstrap/probe.bootstrap.js": bootstrap(`return () => { state.closed = true; };`),
    "modules/failed/package.json":
      '{"name":"@test/failed","type":"module","tulipes":{"dependsOn":["probe"]}}',
    "modules/failed/bootstrap/failed.bootstrap.js": `export default () => () => { throw new Error('intentional failure'); };`,
  });

  const handle = await app.boot({ mode: "script" });

  await expect(handle.shutdown()).rejects.toThrow(/intentional failure/);

  expect(state.closed).toBe(true);
});

test("ctx.signal ends an idle SSE before HTTP waits while ordinary requests keep their resources", async () => {
  const state = probe({ closed: false, aborts: 0, started: false });
  const app = await fixture({
    "modules/probe/bootstrap/probe.bootstrap.js": bootstrap(`
      ctx.signal.addEventListener('abort', () => { state.aborts++; state.stream?.end(); });
      return () => { state.closed = true; };
    `),
    "modules/probe/module.acl.js": `export default acl => acl.defineRole('guest').allow('guest', 'probe:web:read', 'probe:web:stream');`,
    "modules/probe/routes/probe.routes.js": `
      import { Router } from 'express';
      const state = globalThis.__probe;
      export default ctx => {
        const r = Router();
        r.get('/stream', ctx.rai({ id: 'probe:web:stream' }), (req, res) => {
          state.stream = res;
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write('event: ready\\ndata: {}\\n\\n');
        });
        r.get('/slow', ctx.rai({ id: 'probe:web:read' }), async (req, res) => {
          state.started = true;
          await new Promise(resolve => { state.release = resolve; });
          res.respond({ data: { closed: state.closed } });
        });
        return r;
      };
    `,
  });

  const handle = await app.boot({ shutdownTimeoutMs: 500 });
  const base = url(handle);

  const stream = await fetch(base + "/stream");
  const body = stream.text();
  void body.catch(() => {});

  const slow = fetch(base + "/slow", { headers: { connection: "close" } });

  await expect.poll(() => state.started).toBe(true);

  const pending = handle.shutdown();

  expect(handle.shutdown()).toBe(pending);
  await Promise.resolve();
  expect(handle.ctx.signal.aborted).toBe(true);

  (state.release as () => void)();

  expect(await (await slow).json()).toMatchObject({ data: { closed: false } });

  await expect(pending).resolves.toBeUndefined();

  expect(await body).toContain("event: ready");
  expect(state).toMatchObject({ aborts: 1, closed: true });
});

test("cleanup failures share the deadline, aggregate errors and preserve later cleanup", async () => {
  const state = probe({ calls: [] as string[] });
  const app = await fixture({
    "modules/probe/bootstrap/probe.bootstrap.js": bootstrap(`return () => { state.calls.push('probe close'); throw new Error('close marker'); };`),
    "modules/stuck/package.json":
      '{"name":"@test/stuck","type":"module","tulipes":{"dependsOn":["probe"]}}',
    "modules/stuck/bootstrap/stuck.bootstrap.js": bootstrap(`return () => { state.calls.push('stuck close'); return new Promise(() => {}); };`),
  });

  const handle = await app.boot({ shutdownTimeoutMs: 250 });
  const started = performance.now();
  const stopping = handle.shutdown();

  void stopping.catch(() => {});

  // Shutdown must not keep the HTTP listener accepting work while a cleanup hangs.
  await expect.poll(() => handle.server!.listening).toBe(false);

  await expect(stopping).rejects.toMatchObject({
    errors: expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining("timed out") }),
      expect.objectContaining({ message: expect.stringContaining("close marker") }),
    ]),
  });

  expect(performance.now() - started).toBeLessThan(1000);

  expect(state.calls).toEqual(["stuck close", "probe close"]);
});

test("the 0.10 lifecycle exports and config factories are refused by name", async () => {
  const hooks = await fixture({
    "modules/probe/module.config.js": `
      import { defineConfig } from '@tulipes/core/config';
      import { z } from 'zod/v4';
      export default defineConfig({ schema: z.object({}) });
      export function onDrain() {}
      export function onShutdown() {}
    `,
  });

  await expect(hooks.boot({ mode: "script" })).rejects.toThrow(
    /module\.config exports "onDrain".*bootstrap\/\*\.bootstrap\.ts.*ctx\.signal[\s\S]*exports "onShutdown"/,
  );

  const factory = await fixture({
    "modules/probe/module.config.js": `export default () => ({ greeting: 'hi' });`,
  });

  await expect(factory.boot({ mode: "script" })).rejects.toThrow(
    /default-exports a factory — the 0\.10 form; export defineConfig\(\{ schema \}\)/,
  );
});

test("ctx.signal aborts during a failed startup, before the cleanups run", async () => {
  const { readFile } = await import("node:fs/promises");
  const app = await fixture();
  const marker = JSON.stringify(app.rootDir + "/order");

  await app.write(
    "modules/probe/bootstrap/probe.bootstrap.js",
    `
    import { appendFileSync } from 'node:fs';
    export default (ctx) => {
      ctx.signal.addEventListener('abort', () => appendFileSync(${marker}, 'abort '));
      return () => appendFileSync(${marker}, 'close');
    };
  `,
  );

  await app.write(
    "modules/probe/routes/probe.routes.js",
    `export default () => { throw new Error('route marker'); };`,
  );

  await expect(app.boot()).rejects.toThrow(/route marker/);

  expect(await readFile(app.rootDir + "/order", "utf8")).toBe("abort close");
});

test("a shutdown requested from a signal listener shares the same operation", async () => {
  const state = probe({ calls: 0 });
  const app = await fixture({
    "modules/probe/bootstrap/probe.bootstrap.js": bootstrap(`
      ctx.signal.addEventListener('abort', () => {
        state.calls++;
        state.reentrant = state.shutdown();
      });
    `),
  });

  const handle = await app.boot({ mode: "script" });

  state.shutdown = handle.shutdown;

  const stopping = handle.shutdown();

  await stopping;

  expect(state.calls).toBe(1);
  expect(state.reentrant).toBe(stopping);
});

test("without APP_ENV the boot reads development files but hides internals; a named development shows them", async () => {
  const app = await fixture({
    "modules/probe/module.acl.js": `export default acl => acl.defineRole('guest').allow('guest', 'probe:web:read');`,
    "modules/probe/routes/probe.routes.js": `
      import { Router } from 'express';
      export default ctx => Router().get('/fail', ctx.rai({ id: 'probe:web:read' }), () => { throw new Error('db at 10.0.0.5'); });
    `,
  });
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    vi.stubEnv("APP_ENV", undefined);
    const unset = await app.boot({ appEnv: undefined });
    expect(unset.ctx).toMatchObject({ appEnv: "development", appEnvDefaulted: true });
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("APP_ENV is not set"));
    const hidden = await (await fetch(url(unset) + "/fail", { headers: { connection: "close" } })).json();
    expect(hidden.errors[0].message).toBe("internal server error");

    const named = await app.boot({ appEnv: "development" });
    expect(named.ctx.appEnvDefaulted).toBeUndefined();
    const shown = await (await fetch(url(named) + "/fail", { headers: { connection: "close" } })).json();
    expect(shown.errors[0].message).toBe("internal: db at 10.0.0.5");
  } finally {
    error.mockRestore();
    stderr.mockRestore();
    vi.unstubAllEnvs();
  }
});
