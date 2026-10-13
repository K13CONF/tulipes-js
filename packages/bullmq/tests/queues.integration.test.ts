import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fixture } from "../../core/tests/fixture.ts";
import type { QueueManager } from "../src/index.ts";

const redisUrl = process.env.TEST_REDIS_URL;
const integration = test.skipIf(!redisUrl);

beforeEach(() => {
  if (redisUrl) vi.stubEnv("REDIS_URL", redisUrl);
});

integration(
  "worker shutdown finishes active jobs before hooks and keeps producers available for hooks",
  async () => {
    const name = `probe.${randomUUID()}`;

    const app = await fixture({
      "package.json": JSON.stringify({ type: "module", tulipes: { providers: { queues: "@tulipes/bullmq" } } }),
      "modules/probe/package.json": JSON.stringify({ name: "@test/probe", type: "module", tulipes: { env: [
          {
            name: "REDIS_URL",
            type: "url",
            default: redisUrl,
            description: "Isolated test Redis",
          },
        ] } }),
      "modules/probe/module.config.js": `
      import { defineConfig } from '@tulipes/core/config';
      import { z } from 'zod/v4';
      export default defineConfig({ schema: z.object({ closed: z.boolean().default(false), started: z.boolean().default(false) }) });
    `,
      "modules/probe/bootstrap/probe.bootstrap.js": `
      export default (ctx) => {
        ctx.signal.addEventListener('abort', () => { ctx.config.probe.draining = true; });
        return async () => {
          ctx.config.probe.closed = true;
          await ctx.queues.add(${JSON.stringify(name)}, 'from-cleanup', {});
        };
      };
    `,
      "modules/probe/queues/probe.queues.js": `
      export default (ctx, queues) => {
        queues.define(${JSON.stringify(name)});
        queues.process(${JSON.stringify(name)}, async () => {
          ctx.config.probe.started = true;
          await new Promise(resolve => { ctx.config.probe.release = resolve; });
          ctx.config.probe.closedDuringJob = ctx.config.probe.closed;
        });
      }
    `,
    });

    const handle = await app.boot({ mode: "worker", listen: false });

    const state = handle.ctx.config.probe as {
      started: boolean;
      release?: () => void;
      closedDuringJob?: boolean;
    };

    afterEach(() => state.release?.());

    await (handle.ctx.queues as QueueManager).add(name, "work", {});

    await expect.poll(() => state.started).toBe(true);

    const stopping = handle.shutdown();

    state.release!();

    await stopping;

    expect(state.closedDuringJob).toBe(false);
    expect(handle.ctx.config.probe).toMatchObject({ draining: true });

    const url = new URL(redisUrl!);

    const observer = new Queue(name, {
      connection: {
        host: url.hostname,
        port: Number(url.port),
        db: Number(url.pathname.slice(1) || 0),
      },
    });

    try {
      expect(await observer.getWaitingCount()).toBe(1);
      expect(await observer.getCompletedCount()).toBe(1);
    } finally {
      await observer.obliterate({ force: true });

      await observer.close();
    }
  },
);

integration(
  "releases Redis connections even if a queue fails to close",
  async () => {
    const { QueueManager } = await import("../src/queue-manager.ts");
    const { BootReport } = await import("@tulipes/core/errors");
    const manager = new QueueManager(redisUrl!);
    const name = `probe.${randomUUID()}`;

    manager.forModule("probe", new BootReport()).define(name);

    const client = await manager.queue(name).client;
    const close = Queue.prototype.close;

    vi.spyOn(Queue.prototype, "close").mockImplementation(function (
      this: Queue,
    ) {
      if (this.name === name)
        return Promise.reject(new Error("queue close failed"));

      return close.call(this);
    });

    try {
      await expect(manager.close()).rejects.toThrow(/queue close failed/);

      await expect.poll(() => client.status, { timeout: 500 }).toBe("end");
    } finally {
      manager.disconnect();
    }
  },
);

const withQueues = (name: string, files: Record<string, string>) => fixture({
  "package.json": JSON.stringify({ type: "module", tulipes: { providers: { queues: "@tulipes/bullmq" } } }),
  "modules/probe/package.json": JSON.stringify({ name: "@test/probe", type: "module", tulipes: { env: [
    { name: "REDIS_URL", type: "url", default: redisUrl, description: "Isolated test Redis" },
  ] } }),
  "modules/probe/queues/probe.queues.js": `
    import { z } from 'zod/v4';
    export const jobs = { ${JSON.stringify(name)}: z.object({ id: z.string(), tries: z.number().int().default(1) }) };
    export default () => {};
  `,
  ...files,
});

integration("a jobs export defines its queue and validates every payload a producer adds", async () => {
  const name = `probe.${randomUUID()}`;
  const app = await withQueues(name, {});
  const handle = await app.boot({ mode: "script" });
  const queues = handle.ctx.queues as QueueManager;

  try {
    expect(queues.names()).toContain(name);
    await expect(queues.add(name, "run", { id: 1 })).rejects.toThrow(
      /^Job data for queue "probe\.[^"]+" is invalid — id: Invalid input: expected string, received number$/,
    );
    await expect(queues.add(name, "run", { id: "x", tries: 1.5 })).rejects.toThrow(/tries: /);
    await queues.add(name, "run", { id: "x" });

    const [job] = await queues.queue(name).getWaiting();
    expect(job?.data).toEqual({ id: "x", tries: 1 }); // the schema's default travelled
  } finally {
    await queues.queue(name).obliterate({ force: true });
    await handle.shutdown();
  }
});

integration("a queue with a schema from two modules is a boot error naming the first", async () => {
  const name = `probe.${randomUUID()}`;
  const app = await withQueues(name, {
    "modules/other/package.json": JSON.stringify({ name: "@test/other", type: "module", dependencies: { "@test/probe": "*" } }),
    "modules/other/queues/other.queues.js": `
      import { z } from 'zod/v4';
      export const jobs = { ${JSON.stringify(name)}: z.object({}) };
      export default () => {};
    `,
  });

  await expect(app.boot({ mode: "script" })).rejects.toThrow(/\[other\][\s\S]*already defined by module "probe"/);
});

integration("a jobs export that is not schemas is refused with the file", async () => {
  const name = `probe.${randomUUID()}`;
  const app = await withQueues(name, {
    "modules/probe/queues/probe.queues.js": `export const jobs = { ${JSON.stringify(name)}: { parse: () => {} } }; export default () => {};`,
  });

  await expect(app.boot({ mode: "script" })).rejects.toThrow(/probe\.queues\.js: jobs\["probe\.[^"]+"\] is not a schema/);
});

integration(
  "a cron pattern without a zone fires in config.timezone.default; a named zone or an interval is left alone",
  async () => {
    const name = `probe.${randomUUID()}`;
    const app = await fixture({
      "package.json": JSON.stringify({ type: "module", tulipes: { providers: { queues: "@tulipes/bullmq" } } }),
      "config/app.config.js": `export default () => ({ timezone: { default: 'Africa/Casablanca', applyToProcess: false } });`,
      "modules/probe/package.json": JSON.stringify({ name: "@test/probe", type: "module", tulipes: { env: [
        { name: "REDIS_URL", type: "url", default: redisUrl, description: "Isolated test Redis" },
      ] } }),
      "modules/probe/queues/probe.queues.js": `
        import { z } from 'zod/v4';
        export const jobs = { ${JSON.stringify(name)}: z.object({ id: z.string() }) };
        export default (ctx, queues) => { queues.define(${JSON.stringify(name)}); };
      `,
    });
    const handle = await app.boot({ mode: "script" });
    const queues = handle.ctx.queues as QueueManager;
    const queue = queues.queue(name);

    try {
      await queues.schedule(name, "nightly", { pattern: "0 2 * * *" }, { name: "run", data: { id: "a" } });
      await queues.schedule(name, "paris", { pattern: "0 2 * * *", tz: "Europe/Paris" }, { name: "run", data: { id: "b" } });
      await queues.schedule(name, "interval", { every: 60_000 }, { name: "run", data: { id: "c" } });

      expect((await queue.getJobScheduler("nightly"))?.tz).toBe("Africa/Casablanca");
      expect((await queue.getJobScheduler("paris"))?.tz).toBe("Europe/Paris");
      expect((await queue.getJobScheduler("interval"))?.tz).toBeUndefined();

      // Scheduling again updates in place rather than adding a second one.
      await queues.schedule(name, "nightly", { pattern: "0 3 * * *" }, { name: "run", data: { id: "a" } });
      expect(await queue.getJobSchedulersCount()).toBe(3);
      expect((await queue.getJobScheduler("nightly"))?.pattern).toBe("0 3 * * *");

      // The declared schema guards a schedule's template like any job.
      await expect(queues.schedule(name, "bad", { pattern: "0 2 * * *" }, { name: "run", data: {} as never }))
        .rejects.toThrow(/Job data for queue/);

      // The older repeat option on add() gets the same default.
      await queues.add(name, "legacy", { id: "d" }, { repeat: { pattern: "0 4 * * *" } });
      const legacy = (await queue.getJobSchedulers()).find((scheduler) => scheduler.pattern === "0 4 * * *");
      expect(legacy?.tz).toBe("Africa/Casablanca");

      expect(await queues.unschedule(name, "paris")).toBe(true);
      expect(await queue.getJobScheduler("paris")).toBeUndefined();
    } finally {
      await queue.obliterate({ force: true });
    }
  },
);
