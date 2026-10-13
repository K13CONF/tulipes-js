import type { Ctx } from "@tulipes/core/boot";
import type { JobSchemas, QueueRegistry } from "@tulipes/bullmq";
import { z } from "zod/v4";

import { moduleLogger } from "@app/core";

/** The declaration: defines the queue, validates producers, types both sides. */
export const jobs = {
  "users.welcome": z.object({ email: z.email(), locale: z.string() }),
} satisfies JobSchemas;

/**
 * Runs in BOTH process modes: backend registers the queue and produces into it,
 * the worker process turns the processor into a live consumer.
 */
export default function usersQueues(ctx: Ctx, queues: QueueRegistry): void {
  // The same logger the backend uses. In the worker process it writes
  // to app-worker.log, so the two processes never share a file.
  const log = moduleLogger(ctx, "users");

  queues.process("users.welcome", async (job) => {
    // No request here to negotiate a locale from, so the one the caller
    // was using travelled with the job. `ctx.t` binds this module's
    // namespace explicitly — the part `req.t` normally does for free.
    const t = ctx.t("users", job.data.locale);

    log.info({ email: job.data.email, subject: t("welcome.subject", { email: job.data.email }) },
      "sending welcome email");
    return { sent: true };
  });
}
