<div align="center">

<img src="https://cdn.jsdelivr.net/npm/@tulipes/core@0.7.1/assets/tulipesjs-logo.png" alt="TulipesJs" width="340">

</div>

# @tulipes/bullmq

The BullMQ **queues provider** for [Tulipes](https://www.npmjs.com/package/@tulipes/core)
apps. Every module's `queues/*.queues.ts` runs in every process: producers exist
everywhere, processors are registered everywhere, and the worker process turns
them into consumers. Core itself no longer installs BullMQ or ioredis; an app
without background work declares no provider and never pays for one.

Requires Node 24.x and a core that ships the provider contract with `serve`/`drain`
hooks. `bullmq` and `ioredis` are this package's own dependencies — the app never
imports BullMQ, and the provider's connections are never shared with the app's
own Redis clients.

## Select it

```jsonc
{ "tulipes": { "providers": { "queues": "@tulipes/bullmq" } } }
```

plus `config.bullmq.redisUrl` wired in `config/app.config.ts` from a variable
the app's sys `core` module declares: `bullmq: { redisUrl: env.core.redisUrl }`.
A `queues/` directory requires the provider automatically; a module that only
produces declares `"tulipes": { "requires": ["queues"] }`. Installing this
package without the declaration selects nothing; a wired URL on its own
starts nothing.

## Use it

```ts
// modules/billing/queues/invoices.queues.ts
import type { Ctx } from "@tulipes/core/boot";
import type { QueueRegistry } from "@tulipes/bullmq";

export default function invoiceQueues(ctx: Ctx, queues: QueueRegistry): void {
  queues.define("billing.send-invoice");
  queues.process("billing.send-invoice", async (job) => ({ sent: true }));
}

// anywhere after acquisition
await requireQueues(ctx).add("billing.send-invoice", "send", { invoiceId });
```

Recurring work is a job scheduler, keyed so that calling it on every boot
updates rather than duplicates. A cron `pattern` fires in the app's
`config.timezone.default` unless it names its own `tz`:

```ts
// a bootstrap, after acquisition
await ctx.queues.schedule("billing.send-invoice", "nightly",
  { pattern: "0 2 * * *" },                       // 02:00 in the app's zone
  { name: "send", data: { invoiceId: "all" } });  // validated by the queue's schema
await ctx.queues.unschedule("billing.send-invoice", "nightly");
```

## Behavior

- One ioredis connection per queue and one blocking connection per worker,
  `maxRetriesPerRequest: null`; owned by core before the first queue file runs.
- Worker mode: `serve()` starts one `Worker` per registered processor; core
  refuses a worker that serves nothing.
- Shutdown: `drain()` closes workers (finishing active jobs) concurrently with
  the HTTP drain and module `onDrain` hooks while producers stay usable — a
  module's `onShutdown` may still enqueue; then queues and connections close in
  reverse provider order, with forced `disconnect()` under the shared deadline.
- Queue names use `.`; duplicates and processors for undefined queues are
  aggregate boot errors naming the modules.

## Versions

`0.1.0-rc.1` requires core `^0.10.0-rc.2`, the candidate that added the `serve`/`drain`
hooks; install both with `@next`. See core's
[MIGRATING.md](https://github.com/K13CONF/tulipes-js/blob/v0.10.0-rc.2/packages/core/MIGRATING.md#0100-rc2--declare-the-queues-provider).
