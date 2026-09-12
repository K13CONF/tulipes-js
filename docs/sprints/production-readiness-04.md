# Sprint 04 — Queues and sockets as optional providers

Status: S10 (queues) merged as PR #8 (`199dc39`); S11 (sockets) delivered on
`feat/sprint-04-s11-sockets` on 2026-09-12 — [sockets design](../design/sockets-provider-design.md).
The sprint acceptance matrix (04-C1–C3) is recorded in §5.

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
| S11.1–S11.4 | Complete | 2026-09-12: `situations` and `attach` added to the contract, `@tulipes/socket.io` extracted, consumers migrated, absence and live behavior proven — [sockets design §4](../design/sockets-provider-design.md#4-evidence-s113-s114-2026-09-12) |
| 04-C1–C3 | See §5 | |

## 5. Sprint acceptance (04-C1–C3)

| Combination (04-C1) | Where it runs | Result |
|---|---|---|
| core only | fixture A of the inventory harness; minimal smoke's launcher | boots, no driver resolvable |
| models only | `packages/mongoose` integration tests (declared models, no queues/sockets) | pass |
| queues with a worker | `packages/bullmq` integration tests; packed production worker | pass |
| sockets with HTTP | `packages/socket.io` integration test (live client, shutdown) | pass |
| production with all providers | packed production runtime smoke, example suite | pass |
| rate limiting without queues | `packages/bullmq` "app-owned Redis client survives" test; the limiter's own client is independent of the provider (design §1 A2) | pass |

04-C2 (offline per selection): `inspectRoutes` validates every declaration
without importing a provider (core `providers.test.ts`, `inspection.test.ts`
with throwing provider files for all three capabilities); the production
offline smoke runs with sockets denied; inspection skips the sockets provider
by situation rather than by special case.

04-C3 (installed-artifact and migration evidence): five verified archives;
`artifacts.mjs verify` refuses a core depending on or declaring from any
extracted driver; the upgrade smoke migrates the published rc.3 starter across
all three providers; per-mode disappearance is recorded in the inventory
(§4.4 mongoose, §4.5 bullmq/ioredis, §4.6 socket.io).
