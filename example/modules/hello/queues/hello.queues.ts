import type { Ctx } from "@tulipes/core/boot";
import type { QueueRegistry } from "@tulipes/bullmq";

import { moduleLogger } from "@app/core";

/**
 * ONE file describes both sides. The backend process registers the queue
 * so routes can produce into it; `pnpm worker` turns the processor
 * into a live consumer. Never duplicate the definition.
 *
 * Queue names use "." — BullMQ reserves ":" as its redis separator.
 */
export default function helloQueues(ctx: Ctx, queues: QueueRegistry): void {
  const { models } = ctx;
  // The same logger the backend uses. In the worker process it writes
  // to app-worker.log, so the two processes never share a file.
  const log = moduleLogger(ctx.Environment, "hello", ctx.mode);

  queues.define("hello.count-greeting");

  queues.process("hello.count-greeting", async (job) => {
    // Jobs retry, so processors must be idempotent-safe. Pass ids in
    // job.data and re-read state here rather than shipping documents.
    const { name } = job.data as { name: string };
    await models!.get("Greeting").updateOne({ name }, { $inc: { times_used: 1 } });
    log.info({ name }, "counted greeting");
    return { counted: name };
  });
}
