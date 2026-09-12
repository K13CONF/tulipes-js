# Queues provider design (S10)

Status: S10.1 map and S10.2 design recorded on 2026-09-12 against `6f4923d`;
extraction evidence is appended in §6 as S10.3–S10.5 land. Builds directly on
the [Mongoose provider design](mongoose-provider-design.md); only differences
are spelled out here.

## 1. Redis consumers (S10.1)

Every place a Redis connection is opened today, with its owner, options, key
space and shutdown step. "Core" rows are the coupling S10 removes; "app" rows
stay exactly as they are and must keep working when no queues are selected.

| # | Consumer | Owner today | Connection(s) | Options | Key space | Opened | Closed |
|---|---|---|---|---|---|---|---|
| Q1 | Queue producers (`Queue` per `define()`) | core `QueueManager` | one ioredis per queue | `maxRetriesPerRequest: null` (BullMQ requirement) | `bull:<queue>:*` | phase 9 `initQueues`, both modes, only when a module has `queues/` files **and** `REDIS_URL` is set | `queues.close()` after module `onShutdown`, before the database; forced `disconnect()` |
| Q2 | Queue consumers (`Worker` per processor) | core `QueueManager.startWorkers` | one blocking ioredis per worker | same | same | worker mode only, after phase 9; zero consumers refuse the boot | `drain()` (worker.close) concurrently with the HTTP drain, before module `onShutdown`; forced `worker.disconnect()` |
| Q3 | BullMQ internal clients (`queue.client`, events) | BullMQ, from Q1/Q2 connections | reuses Q1/Q2 | — | same | with Q1/Q2 | with Q1/Q2 (`releases Redis connections even if a queue fails to close` test) |
| A1 | Application cache (`appCache`) | app sys `core` module | one ioredis, process singleton | driver defaults | app-chosen keys | lazily on first `appCache()` when `REDIS_URL` is declared | `closeCache()` from the core module's `onShutdown` (`quit`) |
| A2 | Rate limiter (`createRateLimits`) | app `security` module | one ioredis per `Environment` | `lazyConnect`, `enableOfflineQueue: false`, `maxRetriesPerRequest: 0`, 1 s connect/command timeouts, errors swallowed, fail-closed 503 | `<RATE_LIMIT_NAMESPACE>:<appEnv>:*` | at security config, `connect()` bounded by 1 s | `closeRateLimits()` from the security module's `onShutdown` (`disconnect`) |
| T1 | Tests/CI | repository | `TEST_REDIS_URL` (CI db 3 for tests, db 4 for the production smoke) | — | — | — | — |

Findings that shape the design:

- Q1/Q2 are the only connections core opens; they are never shared with A1/A2
  (different ioredis instances, different options). Closing them cannot affect
  the cache or the limiter — true today and preserved by giving the provider
  its own instances.
- `REDIS_URL` is declared by the app's sys `core` module for **three** users
  (Q1/Q2, A1, A2). Selecting no queues must leave the variable and A1/A2 alone;
  the provider reads it the way the Mongoose provider reads `MONGO_URI`.
- The production app therefore keeps `ioredis` as its own dependency after
  extraction (cache and limiter). The claim S10.5 can make is: a queue-free
  install has no BullMQ and no ioredis **from core**; the reference app's
  ioredis is application-owned and stays.
- Producer availability during shutdown is a contract: the retained test
  enqueues from `onShutdown` after consumers drained. The `drain`/`dispose`
  split in §3 preserves it.

## 2. Capability by mode (S10.2)

| Mode | Acquire | Expose | Serve | Drain | Dispose |
|---|---|---|---|---|---|
| backend | connect producers for every `define()`, register processors (never start) | `ctx.queues` (`add`, `queue`, `names`, `processorCount`) | — | — | close queues, quit connections |
| worker | same | same | `serve()` starts one `Worker` per registered processor and returns the count; core refuses 0 | `drain()` closes workers, finishing active jobs | same |
| script | same (producers usable from scripts) | same | — | — | same |
| runtime inspection | same as backend | same | — | — | same |
| offline inspection / `sync` | never imported; declaration and `requires` validated | — | — | — | — |
| queues not selected | nothing | `ctx.queues` undefined; `requireQueues(ctx)` throws naming `tulipes.providers.queues` | worker mode refuses with the existing "zero processors" error | — | — |
| selected, no `REDIS_URL` | boot error naming the variable | — | — | — | — |
| selected, Redis unreachable | producers are lazy in ioredis; the first `add()` fails — unchanged from today; readiness is not blocked | — | — | — | — |

Requirement: a `queues/` directory implies `requires: ["queues"]`; a module
that only produces declares it explicitly (`users` produces into
`users.welcome` which it also owns, `hello` likewise — no explicit case in
the reference app today).

## 3. Core changes

```ts
export const providerCapabilities = ["models", "queues"] as const;

export interface QueuesCapability {}                   // augmented by @tulipes/bullmq
export interface ProviderCapabilities { models: ModelsCapability; queues: QueuesCapability; }
export interface Ctx { /* … */ queues?: QueuesCapability; }
export function requireQueues(ctx: Pick<Ctx, "queues">): QueuesCapability;

export interface AcquiredResource {
  dispose(): unknown | Promise<unknown>;
  forceDispose?(): unknown | Promise<unknown>;
  status(): ProviderStatus;                          // + optional `detail`
  /** Worker mode only: start consuming; return the number of consumers. */
  serve?(report: BootReport): number | Promise<number>;
  /** Shutdown phase 1: stop long-lived consumption; dependencies stay available. */
  drain?(): unknown | Promise<unknown>;
}
```

Boot: phase 8 acquires declared providers in capability order (`models`, then
`queues`); the worker branch calls `serve` on every acquired resource that has
one and refuses when the sum is zero; `printStartupBanner` reads statuses.
Shutdown: `drain` runs in the concurrent phase with `http`/`sockets`/`onDrain`;
`dispose` runs after module `onShutdown` in reverse acquisition order —
queues before models, exactly today's order.

Provider augmentation:

```ts
declare module "@tulipes/core/boot" {
  interface QueuesCapability {
    add(queue: string, job: string, data: unknown, options?: JobsOptions): Promise<void>;
    queue(name: string): Queue;
    names(): string[];
    readonly processorCount: number;
    readonly workerCount: number;
  }
}
export type QueuesFn = (ctx: Ctx, queues: QueueRegistry) => void | Promise<void>;
export { QueueManager, QueueRegistry };
```

`@tulipes/core/queues` becomes a migration stub like `@tulipes/core/db`.

## 4. Package and compatibility

- `@tulipes/bullmq` 0.1.0-rc.1; `dependencies`: `bullmq ^5`, `ioredis ^5` (the
  app never imports BullMQ; a second ioredis copy next to the app's own is
  harmless — no `instanceof` crosses the boundary); `peerDependencies`:
  `@tulipes/core`. `artifacts.mjs verify` refuses a core that depends on
  `bullmq` or `ioredis` and core declarations importing either.
- Declaration: `"tulipes": { "providers": { "queues": "@tulipes/bullmq" } }`.
- Migration: root manifest declaration + dependency; modules with `queues/`
  add the dependency; `import type { QueueRegistry } from "@tulipes/core/queues"`
  → `from "@tulipes/bullmq"`. `ctx.queues`, `requireQueues`, `queues.define/process`
  unchanged. The upgrade smoke applies both the models and the queues steps.
- Minimal preset: unchanged; absence probe adds `bullmq`, `ioredis`,
  `@tulipes/bullmq` for minimal (app, core, launcher) and `bullmq`/`@tulipes/bullmq`
  never through the launcher for production.
- `tulipes new module`: `queues/` file emitted only when a queues provider is
  declared (`--queues`/`--no-queues` override, mirroring `--model`).

## 5. Fixtures

Core (fake provider, no Redis): `serve` called in worker mode only and its
count summed; zero total refuses; `drain` runs before module `onShutdown` and
`dispose` after; a provider without `serve` in worker mode counts as zero.
Provider (real Redis): the two moved tests; selected without `REDIS_URL`;
undeclared with `REDIS_URL` set opens no connection; `queues/` without a
declaration refused before import; producer available from `onShutdown` after
drain; closing the provider leaves an app-owned ioredis connection open.

## 6. Evidence

### 6.1 Extraction (S10.3, S10.5; 2026-09-12)

| Claim | Evidence | Result |
|---|---|---|
| Runtime moved | `packages/bullmq/src/{queue-manager,load-queues,provider,index}.ts`; the manager is owned via `own()` before the first queue file runs; `serve` → `startWorkers`, `drain` → `drain`, `dispose` → `close`, `forceDispose` → `disconnect` | pass |
| Core free of BullMQ/ioredis | packed core `dependencies`: colorette, dotenv, express, i18next, i18next-fs-backend, socket.io, tsx, zod; `artifacts.mjs verify` refuses core depending on or declaring from `mongoose`, `bullmq`, `ioredis` | pass |
| Packed absence | minimal smoke probe: `bullmq`, `@tulipes/bullmq`, `ioredis` (and the S09 targets) unresolvable from app, core and launcher | pass |
| Worker behavior preserved | packed production runtime smoke: worker boots through `serve()` (banner "consuming N queue(s)"), login, PM2; example suite 55 tests; moved integration tests (drain before `onShutdown`, producer usable from the hook, connection release on close failure) pass against local Redis | pass |
| Consumers migrated | generator and reference app declare `queues: "@tulipes/bullmq"`, `users`/`hello` depend on it, two queue files import from it; parity diffs; `new module --queues/--no-queues` | pass |
| Upgrade | `upgrade-smoke.mjs`: the rc.3 starter is refused for both missing capabilities, `@tulipes/core/queues` declared gets the "no longer contains" diagnostic, `QueueRegistry` import fails with "no exported member"; migrated app (8 imports, 4 manifests) installs, typechecks, describes itself offline | pass |
| Suite | 244 tests with services, coverage 85/73/88/87, `test:types`, workspace typecheck, example typecheck, template parity | pass |

### 6.2 Failure and omission matrix (S10.4; 2026-09-12)

Core, fake provider (`packages/core/tests/providers.test.ts`, no Redis):
`serve()` runs in worker mode only and its sum becomes `handle.consumers`; a
zero sum or a provider without `serve` refuses the worker and still disposes;
`drain()` and module `onDrain` both precede module `onShutdown`, which still
sees `ctx.queues`, and `dispose()` follows; a `queues/` directory implies the
requirement before the file is imported.

Provider, real Redis (`packages/bullmq/tests/provider-matrix.integration.test.ts`):

| Scenario | Outcome asserted |
|---|---|
| `REDIS_URL` set, provider installed, not declared | no client opened (Redis `CLIENT LIST` unchanged), `ctx.queues` undefined |
| Declared, `REDIS_URL` unset | `provider "bullmq" is selected but "REDIS_URL" is not declared/set` |
| `queues/` file, no declaration | refused before the file is imported |
| Producer-only module with `requires: ["queues"]` | enqueues into another module's queue; banner detail `1 processor(s) registered`; `consumers` 0 in backend |
| Worker | `consumers` 1, detail `…, 1 consuming`, a job is processed; a declared provider with no processors refuses the worker |
| App-owned Redis client | survives provider drain and dispose: the module's `onShutdown` pings it after the drain, and it answers after shutdown |
| Moved tests | drain finishes the active job before `onShutdown` and the hook can still enqueue; connections released even when a queue fails to close |

Statuses are refreshed after `serve()` so the banner and `handle.providers`
report running consumers (found by this matrix).

