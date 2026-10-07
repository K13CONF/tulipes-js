---
name: tulipes-queue
description: Use when adding background work to a Tulipes app — emails, webhooks, exports, scheduled retries — or when a request handler is doing something slow. Covers the queues contract, producing jobs, and the backend/worker process split.
---

# Adding a background job

One file declares both sides of a queue, and the process mode decides what
happens with it: the **backend** process registers the queue so routes can
produce into it; the **worker** process turns the processor into a live
consumer. Never duplicate the definition.

`modules/billing/queues/invoices.queues.ts`:

```ts
import type { Ctx } from "@tulipes/core/boot";
import type { QueueRegistry } from "@tulipes/bullmq";

export default function invoiceQueues({ models }: Ctx, queues: QueueRegistry): void {
  queues.define("billing.send-invoice");

  queues.process("billing.send-invoice", async (job) => {
    const invoice = await models!.get("Invoice").findById(job.data.invoiceId);
    // …do the slow thing here…
    return { sent: true };
  });
}
```

Produce from anywhere with the context:

```ts
await queues!.add("billing.send-invoice", "send", { invoiceId: invoice.id });
```

Run a consumer with `pnpm worker`. Without it, jobs pile up in Redis and
nothing processes them — that is the correct behaviour, not a bug.

## Rules

- **Queue names use `.`, never `:`** (`billing.send-invoice`). BullMQ
  reserves `:` as its Redis key separator; a `:` name crashes the boot.
- Names are globally unique, and a queue may have only one processor —
  duplicates crash the boot naming both modules.
- A processor registered for a queue nobody defined is a boot error; call
  `define()` in the same file.
- The app selects its queue provider once, in its root `package.json`:
  `"tulipes": { "providers": { "queues": "@tulipes/bullmq" } }`. A module with a
  `queues/` file in an app without that line is a boot refusal before any
  module is imported; a module that only produces declares
  `"tulipes": { "requires": ["queues"] }` in its own manifest.
- The provider needs `REDIS_URL` declared (sys `core` module) and set;
  selected without a value is a boot refusal. The app's own Redis users
  (cache, rate limiter) keep their own connections and their own `ioredis`.
- Worker mode with zero processors refuses to start: a consumer with
  nothing to consume is a misconfigured deployment.

## Writing a processor

- **Jobs retry.** Make the handler idempotent — the same job may run twice
  after a crash or timeout.
- Pass identifiers in `job.data`, not whole documents; re-read from the
  database inside the processor so the job acts on current state.
- Keep payloads small and JSON-serializable.
- Throwing marks the job failed and schedules a retry per its options; let
  it throw rather than swallowing errors.
- Both processes run the full boot pipeline, so `models`, `config` and
  `Environment` are all available inside a processor.
