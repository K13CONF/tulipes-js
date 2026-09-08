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
  const state = handle.ctx.config.probe as { started: boolean; release: () => void };
  const response = fetch(url(handle) + "/slow", { headers: { connection: "close" } });
  await expect.poll(() => state.started).toBe(true);
  const shutdown = handle.shutdown();
  state.release();
  expect(await (await response).json()).toMatchObject({ data: { closed: false } });
  await shutdown;
});

test("cleans up configured modules when a later boot phase fails", async () => {
  const { readFile } = await import("node:fs/promises");
  const app = await fixture();
  const marker = JSON.stringify(app.rootDir + "/closed");
  await app.write("modules/probe/module.config.js", `
    import { writeFileSync } from 'node:fs';
    export default () => ({});
    export function onShutdown() { writeFileSync(${marker}, 'closed'); }
  `);
  await app.write("modules/probe/routes/probe.routes.js", `export default () => { throw new Error('route failed'); };`);
  await expect(app.boot()).rejects.toThrow(/route failed/);
  expect(await readFile(app.rootDir + "/closed", "utf8")).toBe("closed");
});

test("bounds a stuck cleanup hook and still attempts later cleanup", async () => {
  const app = await fixture({
    "modules/probe/module.config.js": `
      export default () => ({ closed: false });
      export function onShutdown(ctx) { ctx.config.probe.closed = true; }
    `,
    "modules/stuck/package.json": '{"name":"@test/stuck","type":"module","tulipes":{"dependsOn":["probe"]}}',
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
  const models = new ModelStore(), queues = new QueueManager("redis://127.0.0.1:1");
  expect(requireModels({ models })).toBe(models);
  expect(requireQueues({ queues })).toBe(queues);
});

test("removes its signal listeners on explicit shutdown", async () => {
  const before = [process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")];
  const app = await fixture();
  const handle = await app.boot({ mode: "script", handleSignals: true });
  await handle.shutdown();
  expect([process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")]).toEqual(before);
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
    errors: [expect.objectContaining({ message: expect.stringContaining("startup marker") }),
      expect.objectContaining({ message: expect.stringContaining("cleanup marker") })],
  });
});

test("attempts remaining module cleanup after a hook throws", async () => {
  const app = await fixture({
    "modules/probe/module.config.js": `
      export default () => ({ closed: false });
      export function onShutdown(ctx) { ctx.config.probe.closed = true; }
    `,
    "modules/failed/package.json": '{"name":"@test/failed","type":"module","tulipes":{"dependsOn":["probe"]}}',
    "modules/failed/module.config.js": `
      export default () => ({});
      export function onShutdown() { throw new Error('intentional failure'); }
    `,
  });
  const handle = await app.boot({ mode: "script" });
  await expect(handle.shutdown()).rejects.toThrow(/intentional failure/);
  expect(handle.ctx.config.probe).toEqual({ closed: true });
});
