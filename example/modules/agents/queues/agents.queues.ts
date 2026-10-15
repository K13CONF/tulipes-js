import type { Ctx, RuntimeCtx } from "@tulipes/core/boot";
import type { JobSchemas, QueueRegistry } from "@tulipes/bullmq";
import { z } from "zod/v4";

import { moduleLogger } from "@app/core";

import { composeLoop } from "../helpers/compose.ts";
import { MongoRunStore } from "../helpers/adapters/mongo-run-store.ts";

/** One job runs a run until it ends or waits for approval. */
export const jobs = {
  "agents.run": z.object({ run_id: z.string().regex(/^[a-f0-9]{24}$/) }),
} satisfies JobSchemas;

/**
 * The worker side of a run. The loop resumes from what is stored, so a
 * retried job — a crash, a stalled lock, a restart — continues where the
 * last one stopped, and a write interrupted mid-call is never re-run. When
 * the last attempt fails, the run is ended `failed` rather than left
 * `running` for nobody.
 */
export default function agentsQueues(ctx: Ctx, queues: QueueRegistry): void {
  const log = moduleLogger(ctx, "agents");

  queues.process("agents.run", async (job) => {
    const runId = job.data.run_id;
    try {
      const run = await composeLoop(ctx as RuntimeCtx).run(runId, ctx.signal);
      return { status: run.status };
    } catch (error) {
      log.error({ err: error, run: runId, attempt: job.attemptsMade + 1 }, "agent run job failed");
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        const store = new MongoRunStore(ctx, { retentionDays: ctx.config.agents!.retentionDays });
        const run = await store.load(runId);
        if (run) await store.end(runId, "failed", { reason: "error" }, run.elapsedMs);
      }
      throw error;
    }
  });
}
