import type { Ctx } from "@tulipes/core/boot";
import type { JobSchemas, QueueRegistry } from "@tulipes/bullmq";
import { z } from "zod/v4";

import { moduleLogger } from "@app/core";

/**
 * The job data each queue accepts. This export is the declaration: it
 * defines the queue, validates every `queues.add()` payload, and
 * `pnpm sync` types `job.data` here and the payload at the producer from
 * it — a wrong queue name or shape no longer compiles.
 */
export const jobs = {
  "hello.count-greeting": z.object({ name: z.string().min(1) }),
} satisfies JobSchemas;

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
  const log = moduleLogger(ctx, "hello");

  queues.process("hello.count-greeting", async (job) => {
    // Jobs retry, so processors must be idempotent-safe. Pass ids in
    // job.data and re-read state here rather than shipping documents.
    const { name } = job.data;
    await models!.get("Greeting").updateOne({ name }, { $inc: { times_used: 1 } });
    log.info({ name }, "counted greeting");
    return { counted: name };
  });
}
