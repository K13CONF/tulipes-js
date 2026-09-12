# Sprint 04 — Queues and sockets as optional providers

Status: S10 (queues) complete on branch `feat/sprint-04-s10-queues` on 2026-09-12,
started from `6f4923d` (core 0.10.0-rc.1 / spec 0.3.0-rc.4 / mongoose
0.1.0-rc.1 published). S11 (sockets) follows as its own increment once S10 is
accepted; the two are estimated separately as the program requires.

Program: [Sprint 04 task definitions](production-readiness-task-report.md#5-sprint-04--make-queues-and-sockets-independently-optional).
Prerequisite: [Sprint 03](production-readiness-03.md) — the provider seam
(`tulipes.providers`, manifest `requires`, `Provider.acquire` with `own()`,
per-boot acquired list, reverse-order disposal) and its evidence.

## 1. Intended result and scope

An app that selects no queues installs no BullMQ and no queue-owned ioredis and
acquires no Redis connection; an app that selects queues keeps today's
backend/worker behavior — producers everywhere, consumers in the worker
process, drain before module disposal, forced teardown under the shared
deadline — with connection ownership that never touches the application's own
Redis consumers (cache, rate limiter).

In scope: S10.1–S10.5. Out of scope: sockets (S11), a queue abstraction over
anything but BullMQ, Redis connection sharing between providers and the app,
and any change to the app-owned cache and rate-limiter policy.

## 2. What the seam already gives S10

Sprint 03 left the mechanism generic on purpose (design §3, "B's shape retained
internally"): capability-keyed declarations, `checkRequirements`, app-anchored
provider resolution, `own()` before any await, reverse-order `dispose` under
`Cleanup`. S10 adds only what queues demonstrably need and Mongoose did not:

| Need | Why | Addition |
|---|---|---|
| Worker mode starts consumers after acquisition and refuses zero consumers | today `ctx.queues.startWorkers(report)` in the worker branch | `AcquiredResource.serve?(report): number \| Promise<number>` — core calls it in worker mode only, sums the counts, keeps the "zero processors" refusal |
| Consumers stop while producers and models remain available to draining work | today `cleanup.run("workers", () => queues.drain())` runs concurrently with the HTTP drain, before module `onShutdown`; `queues.close()` runs after | `AcquiredResource.drain?()` — run in the drain phase alongside `http`/`sockets`; `dispose` stays where it is |
| Banner shows queues/processors/consumers | today reads `QueueManager` members | `ProviderStatus.detail?: string`; the worker row reads the summed `serve()` count |

`drain` is also what the socket provider will need (S11), so it is added as a
generic hook rather than a queue-specific one; nothing else in core learns
what a queue is.

## 3. Delivery sequence

| Change set | Work | Checks |
|---|---|---|
| S10-plan + S10.1 + S10.2 | This plan, the Redis consumer map and the queues design ([design doc](../design/queues-provider-design.md)) | links, scope |
| S10.3 + S10.5 (inseparable, as in S09) | `packages/bullmq` with the moved manager/loader; core `queues` slot as `QueuesCapability`, `serve`/`drain` hooks, dependency removal, migration stub at `@tulipes/core/queues`; generator, example, `new module`, skills; artifacts/smoke for four archives; absence probe extended | full suite with services, types, parity, packed smokes, upgrade smoke |
| S10.4 | Real-driver matrix in the provider package; fake-provider `serve`/`drain` tests in core | suite with services |
| S10 measure + close | Harness graph generalization and before/after inventory; trackers | harness run |

## 4. Tracker

| Item | Status | Evidence |
|---|---|---|
| S10.1 | Complete | Consumer map in the [design doc §1](../design/queues-provider-design.md#1-redis-consumers-s101) |
| S10.2 | Complete | [Design doc §2–§4](../design/queues-provider-design.md#2-capability-by-mode-s102) |
| S10.3, S10.5 | Complete | 2026-09-12: `packages/bullmq` holds the manager and loader; core drops `bullmq` and `ioredis`, gains `serve`/`drain` hooks and `BootHandle.consumers`; generator, example, `new module`, skills migrated; four archives, absence probe covers `bullmq`, `ioredis`, `@tulipes/bullmq`; upgrade smoke applies both migrations — [design §6](../design/queues-provider-design.md#6-evidence) |
| S10.4 | Complete | 2026-09-12: fake-provider `serve`/`drain` contract tests in core, six real-Redis scenarios plus the two moved tests in the provider — [design §6.2](../design/queues-provider-design.md#62-failure-and-omission-matrix-s104-2026-09-12) |
| S10 measure | Complete | [inventory §4.5](../design/mongoose-dependency-inventory.md#45-after-the-queues-extraction-sprint-04-s10): core-only −24.0%, minimal readiness −33%, remaining app-owned ioredis reported |
| S11 | Not started | Own increment after S10 acceptance; `socket.io` is 4.9 MB exclusive in the core-only fixture |
| 04-C1–C3 | Not started | Combination matrix is run when both providers exist; S10 records the queue-relevant rows |
