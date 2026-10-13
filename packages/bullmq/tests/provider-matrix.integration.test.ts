import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fixture as coreFixture } from "../../core/tests/fixture.ts";
import type { QueueManager } from "../src/index.ts";

// Every fixture wires config.bullmq the way an app's config/app.config.ts does.
const wiring = `export default (env) => ({ bullmq: { redisUrl: env.probe?.redisUrl } });`;
const fixture = (files: Record<string, string> = {}) => coreFixture({ "config/app.config.js": wiring, ...files });
/**
 * S10.4 — the queues provider with a real Redis: selection semantics,
 * requirement shapes, worker consumption and the boundary with the
 * application's own Redis clients.
 */

const redisUrl = process.env.TEST_REDIS_URL;
const integration = test.skipIf(!redisUrl);

const declared = JSON.stringify({ type: "module", tulipes: { providers: { queues: "@tulipes/bullmq" } } });
const redisMeta = JSON.stringify({ name: "@test/probe", type: "module", tulipes: { env: { redisUrl: { key: "REDIS_URL", type: "url", default: redisUrl, description: "Isolated test Redis" } } } });
const queueFile = (name: string) => `
  export default (ctx, queues) => {
    queues.define(${JSON.stringify(name)});
    queues.process(${JSON.stringify(name)}, async (job) => { ctx.config.probe.handled = (ctx.config.probe.handled ?? 0) + 1; return job.data; });
  };
`;

beforeEach(() => {
  if (redisUrl) vi.stubEnv("REDIS_URL", redisUrl);
});

/** Connections opened against the test Redis by this process, by client name. */
async function clientNames(): Promise<string[]> {
  const probe = new Redis(redisUrl!);
  try {
    const list = await probe.client("LIST");
    return String(list).split("\n").filter(Boolean).map((line) => /name=(\S*)/.exec(line)?.[1] ?? "");
  } finally {
    await probe.quit();
  }
}

integration("a REDIS_URL without a declaration starts nothing, even with the provider installed", async () => {
  const app = await fixture({ "modules/probe/package.json": redisMeta });
  const before = (await clientNames()).length;

  const handle = await app.boot({ mode: "script" });

  expect(handle.ctx.queues).toBeUndefined();
  expect(handle.providers).toEqual([]);
  expect((await clientNames()).length).toBe(before);
});

integration("a declared provider without config.bullmq.redisUrl is a boot error naming the key to wire", async () => {
  vi.stubEnv("REDIS_URL", undefined);
  const app = await fixture({ "package.json": declared });

  await expect(app.boot({ mode: "script" })).rejects.toThrow(/provider "bullmq" is selected but config\.bullmq\.redisUrl is not set — wire it in config\/app\.config\.ts/);
});

integration("a queues file without a declaration is refused before it is imported", async () => {
  const app = await fixture({
    "modules/probe/package.json": redisMeta,
    "modules/probe/queues/work.queues.js": `throw new Error('queue file imported');`,
  });

  await expect(app.boot({ mode: "script" })).rejects.toThrow(/\[probe\] requires capability "queues" \(has queues\/ files\)/);
});

integration("a producer-only module declares the requirement and can enqueue into another module's queue", async () => {
  const name = `probe.${randomUUID()}`;
  const app = await fixture({
    "package.json": declared,
    "modules/probe/package.json": redisMeta,
    "modules/probe/queues/work.queues.js": queueFile(name),
    "modules/producer/package.json": JSON.stringify({ name: "@test/producer", type: "module", tulipes: { dependsOn: ["probe"], requires: ["queues"] } }),
  });

  const backend = await app.boot({ listen: false });
  const queues = backend.ctx.queues as QueueManager;

  expect(queues.names()).toEqual([name]);
  expect(backend.consumers).toBe(0);
  expect(backend.providers).toEqual([expect.objectContaining({ capability: "queues", provider: "bullmq", ready: true, detail: "1 processor(s) registered" })]);

  await queues.add(name, "hello", { from: "producer" });
  await queues.add(name, "hello", { from: "test" });
  expect(await queues.queue(name).getWaitingCount()).toBe(2);

  await queues.queue(name).obliterate({ force: true });
  await backend.shutdown();
});

integration("the worker serves every processor and reports it; a queue-free worker is refused", async () => {
  const name = `probe.${randomUUID()}`;
  const app = await fixture({
    "package.json": declared,
    "modules/probe/package.json": redisMeta,
    "modules/probe/module.config.js": `import { defineConfig } from '@tulipes/core/config'; import { z } from 'zod/v4'; export default defineConfig({ schema: z.object({}) });`,
    "modules/probe/queues/work.queues.js": queueFile(name),
  });

  const worker = await app.boot({ mode: "worker" });
  const queues = worker.ctx.queues as QueueManager;

  expect(worker.consumers).toBe(1);
  expect(worker.providers[0]?.detail).toBe("1 processor(s) registered, 1 consuming");

  await queues.add(name, "job", { n: 1 });
  await expect.poll(() => (worker.ctx.config.probe as { handled?: number }).handled, { timeout: 5_000 }).toBe(1);

  await queues.queue(name).obliterate({ force: true });
  await worker.shutdown();

  const idle = await fixture({ "package.json": declared, "modules/probe/package.json": redisMeta });
  await expect(idle.boot({ mode: "worker" })).rejects.toThrow(/worker mode started with zero processors/);
});

integration("disposing the provider leaves the application's own Redis client connected", async () => {
  const name = `probe.${randomUUID()}`;
  const app = await fixture({
    "package.json": declared,
    "modules/probe/package.json": redisMeta,
    "modules/probe/module.config.js": `import { defineConfig } from '@tulipes/core/config'; import { z } from 'zod/v4'; export default defineConfig({ schema: z.object({}) });`,
    "modules/probe/bootstrap/probe.bootstrap.js": `
      import { Redis } from 'ioredis';
      export default (ctx) => {
        const mine = new Redis(process.env.REDIS_URL, { connectionName: 'app-owned' });
        ctx.config.probe.mine = mine;
        return async () => { ctx.config.probe.pingAfterDrain = await mine.ping(); };
      };
    `,
    "modules/probe/queues/work.queues.js": queueFile(name),
  });

  const worker = await app.boot({ mode: "worker" });
  await expect.poll(async () => (await clientNames()).includes("app-owned"), { timeout: 2_000 }).toBe(true);

  await worker.shutdown();

  const state = worker.ctx.config.probe as { mine: Redis; pingAfterDrain?: string };
  // The module's cleanup ran after the provider drained and still used its own client.
  expect(state.pingAfterDrain).toBe("PONG");
  expect(await state.mine.ping()).toBe("PONG");
  expect((await clientNames()).includes("app-owned")).toBe(true);

  await state.mine.quit();
  const observer = new Redis(redisUrl!);
  try {
    await observer.del(`bull:${name}:meta`);
  } finally {
    await observer.quit();
  }
});

integration("driver errors on producers and consumers never escape as unhandled events", async () => {
  const name = `probe.${randomUUID()}`;
  const app = await fixture({
    "package.json": declared,
    "modules/probe/package.json": redisMeta,
    "modules/probe/module.config.js": `import { defineConfig } from '@tulipes/core/config'; import { z } from 'zod/v4'; export default defineConfig({ schema: z.object({}) });`,
    "modules/probe/queues/work.queues.js": queueFile(name),
  });

  const worker = await app.boot({ mode: "worker" });
  const queues = worker.ctx.queues as QueueManager;
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});

  // BullMQ re-emits driver errors here; without a listener this throws.
  expect(() => queues.queue(name).emit("error", new Error("transient"))).not.toThrow();
  expect(errors).toHaveBeenCalledWith(expect.stringMatching(/queue ".*": transient/));

  const closing = worker.shutdown();
  // Once the drain phase has started, the same event is expected and must stay silent.
  await new Promise((resolve) => setImmediate(resolve));
  errors.mockClear();
  queues.queue(name).emit("error", new Error("Connection is closed."));
  await closing;
  expect(errors).not.toHaveBeenCalled();

  const observer = new Redis(redisUrl!);
  try { await observer.del(`bull:${name}:meta`); } finally { await observer.quit(); }
});

integration("shutting down while a consumer is still connecting rejects nothing", async () => {
  const name = `probe.${randomUUID()}`;
  const app = await fixture({
    "package.json": declared,
    "modules/probe/package.json": redisMeta,
    "modules/probe/module.config.js": `import { defineConfig } from '@tulipes/core/config'; import { z } from 'zod/v4'; export default defineConfig({ schema: z.object({}) });`,
    "modules/probe/queues/work.queues.js": queueFile(name),
  });

  const rejections: unknown[] = [];
  const collect = (reason: unknown) => rejections.push(reason);
  process.on("unhandledRejection", collect);

  try {
    // Shut down immediately: the consumer may still be connecting, and its
    // offline-queued startup commands must not reject into nobody.
    const worker = await app.boot({ mode: "worker" });
    await worker.shutdown();

    // Give any stray rejection a turn to surface before asserting.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rejections).toEqual([]);
  } finally {
    process.off("unhandledRejection", collect);
    const observer = new Redis(redisUrl!);
    try { await observer.del(`bull:${name}:meta`); } finally { await observer.quit(); }
  }
});
