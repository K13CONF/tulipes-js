import type { QueuesCapability } from "@tulipes/core/boot";

import "../src/index.ts";

declare const queues: QueuesCapability;

// One-off jobs keep BullMQ's job options.
void queues.add("billing", "send", {}, { delay: 1_000, attempts: 3 });

// BullMQ 6 removed repeat from add(); recurring work goes through schedule().
// @ts-expect-error repeat is not a job option any more.
void queues.add("billing", "nightly", {}, { repeat: { pattern: "0 2 * * *" } });

void queues.schedule("billing", "nightly", { pattern: "0 2 * * *", tz: "UTC" }, { name: "send", data: {} });

// cron-parser 5 options BullMQ 6 no longer forwards.
// @ts-expect-error utc is gone: use tz: "UTC".
void queues.schedule("billing", "nightly", { pattern: "0 2 * * *", utc: true }, { name: "send", data: {} });
