import type { Provider } from "../boot/providers.ts";

/**
 * `@tulipes/core/queues` moved to `@tulipes/bullmq`. What remains is the
 * migration diagnostic: an app still declaring this subpath as its queues
 * provider gets one boot error naming the fix, and `QueueRegistry`/`QueuesFn`
 * imports fail with "no exported member" — see MIGRATING.md.
 */
const moved: Provider<"queues"> = {
  contract: 2,
  capability: "queues",
  name: "core/queues (moved)",
  async acquire(_ctx, report) {
    report.add({
      scope: "providers",
      message: '"@tulipes/core/queues" no longer contains the BullMQ provider — install @tulipes/bullmq, declare "tulipes": { "providers": { "queues": "@tulipes/bullmq" } } and import QueueRegistry/QueuesFn from it',
    });
    return undefined;
  },
};

export default moved;
