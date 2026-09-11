import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fixture } from "./fixture.js";

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
      "modules/probe/meta.variables.json": JSON.stringify({
        variables: [
          {
            name: "REDIS_URL",
            type: "url",
            default: redisUrl,
            description: "Isolated test Redis",
          },
        ],
      }),
      "modules/probe/module.config.js": `
      export default () => ({ closed: false, started: false });
      export function onDrain(ctx) { ctx.config.probe.draining = true; }
      export async function onShutdown(ctx) {
        ctx.config.probe.closed = true;
        await ctx.queues.add(${JSON.stringify(name)}, 'from-hook', {});
      }
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

    await handle.ctx.queues!.add(name, "work", {});

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
    const { QueueManager } = await import("../src/queues/queue-manager.js");
    const { BootReport } = await import("../src/errors/boot-error.js");
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
