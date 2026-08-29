import type { Ctx } from "@forgex/core/boot";
import type { QueueRegistry } from "@forgex/core/queues";

/**
 * Runs in BOTH process modes: web registers the queue and produces into it,
 * the worker process turns the processor into a live consumer.
 */
export default function usersQueues(_ctx: Ctx, queues: QueueRegistry): void {
  queues.define("users.welcome");

  queues.process("users.welcome", async (job) => {
    console.log(`[users] sending welcome email to ${job.data.email}`);
    return { sent: true };
  });
}
