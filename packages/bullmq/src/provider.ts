import type { Provider } from "@tulipes/core/boot";

import { initQueues } from "./load-queues.js";
import type { QueueManager } from "./queue-manager.js";

/**
 * The "queues" provider an app selects with
 * `"tulipes": { "providers": { "queues": "@tulipes/bullmq" } }`.
 *
 * Core owns the phase order, the worker refusal and the shutdown deadline;
 * this package owns the Redis connections BullMQ needs — one per queue and
 * one blocking connection per worker, never shared with the application's
 * own cache or rate-limiter clients — and their drain/close/force order.
 */
export const provider: Provider<"queues"> = {
  contract: 1,
  capability: "queues",
  name: "bullmq",
  async acquire({ ctx, files }, report, own) {
    let manager: QueueManager | undefined;
    const acquired = await initQueues(files, ctx, report, (created) => {
      manager = created;
      own({
        // Consumers stop while producers stay usable by draining requests,
        // jobs and module onShutdown hooks; those close at dispose.
        drain: () => created.drain(),
        dispose: () => created.close(),
        forceDispose: () => created.disconnect(),
        serve: (workerReport) => created.startWorkers(workerReport),
        status: () => ({
          label: `redis (${created.names().length} queue(s))`,
          ready: true,
          detail: `${created.processorCount} processor(s) registered${created.workerCount ? `, ${created.workerCount} consuming` : ""}`,
        }),
      });
    });
    return acquired && manager ? manager : undefined;
  },
};
