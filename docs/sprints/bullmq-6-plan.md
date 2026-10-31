# Plan — `@tulipes/bullmq` on BullMQ 6

Status: **implemented 2026-10-31 on `feat/bullmq-6`**, verified locally,
prepared as part of 0.13.2 ([release record](./release-0.13.2.md)). Not yet
through CI, not published.

## Why

`pnpm install` warns `1 deprecated subdependencies found: cron-parser@4.9.0`.
It comes from `@tulipes/bullmq → bullmq 5.81.5 → cron-parser 4.9.0`, which
BullMQ 5 pins exactly ("v4 is no longer maintained, upgrade to v5"). BullMQ
6.0.0 (2026-07-30) moved to cron-parser 5; 6.5.3 is current. No 5.x release
will drop the warning, and forcing cron-parser 5 under BullMQ 5 through
`overrides` is unsafe, because cron-parser 5 changed its API.

## What BullMQ 6 breaks for us

Taken from BullMQ's changelog and the 6.5.3 type definitions, compared with
`packages/bullmq/src/queue-manager.ts`:

| Change in 6.0.0 | Effect here |
|---|---|
| `repeat` removed from `Queue#add` / `addBulk` (`JobsOptions`) | **Breaking for apps.** `ctx.queues.add(…, { repeat })` stops compiling and stops working. `QueueManager.add` zones `options.repeat` (line 210), and `queues.integration.test.ts:220-223` tests that "legacy" path. |
| `RepeatOptions` loses `utc`, `currentDate`, `nthDayOfWeek` | `schedule()` takes `Omit<RepeatOptions, "key">`, so apps passing these fail typecheck. Use `tz: "UTC"` instead of `utc`. |
| `ioredis` becomes an optional peer | None. It is already a direct dependency (`ioredis ^5`). |
| `connection` option | Still accepts an ioredis instance (`ConnectionOptions` includes `IRedisClient`). `#connect()` stays as it is. |
| `waitUntilReady()` resolves `void` | None. `drain()`/`close()` ignore the value. |
| `Worker#resume()` async, `paused` state gone, `debounce`, `Job#discard()`, `Queue#client` removed | Not used by the provider, the example app or the templates (grepped). Apps that call these on `ctx.queues.queue(name)` break. Call that out in the migration note. |

Unchanged and still in use: `Queue`, `Worker`, `Processor`, `QueueOptions`,
`WorkerOptions`, `upsertJobScheduler`, `removeJobScheduler`, `getJobScheduler(s)`,
`obliterate`, `disconnect`.

## Scope (one change set)

1. **Dependency.** `packages/bullmq/package.json`: `"bullmq": "^6"`. Lock to
   a 6.x release that is at least two weeks old (6.3.16 is from 2026-10-17;
   6.5.x came out this week). Then confirm with `pnpm why cron-parser` that
   cron-parser 5 is the only copy and the warning is gone.
2. **Provider API.** In `queue-manager.ts`, `add()` drops its `repeat`
   handling and `options` becomes `Omit<JobsOptions, "repeat">`. BullMQ's own
   type already enforces that, but naming it documents it. `schedule()` is
   the single path for recurring jobs, and `#zoned` stays for it. Update the
   doc comment on `QueuesCapability.add`.
3. **Tests.** Delete the "legacy" `add({ repeat })` assertion in
   `queues.integration.test.ts`. Add a `.test-d.ts` case proving
   `ctx.queues.add(…, { repeat })` is a type error. Leave the rest of the
   suite unchanged: the scheduler, drain/close and provider-matrix tests are
   the regression net.
4. **Docs.** `packages/bullmq/README.md`, `docs/design/queues-provider-design.md`
   and the `CHANGELOG` for `@tulipes/bullmq`. Add a short `MIGRATING` entry:
   replace `add(…, { repeat })` with `schedule(queue, schedulerId, repeat, job)`
   and `utc: true` with `tz: "UTC"`, and list the removed BullMQ members for
   apps that use `queue(name)` directly.
5. **Release mechanics** per `docs/releasing.md`. Bump `@tulipes/bullmq`
   0.2.3 → **0.3.0**, a breaking change on 0.x. Core doesn't change, so the
   other archives keep their versions unless `artifacts.mjs prepare` says
   otherwise. Check whether the CLI's pinned scaffold versions
   (`versions.json`, and `new-module.ts:147`'s stale `"^0.1.1"`) need the new
   range. If they do, the CLI gets a patch bump.

Out of scope (record in backlog if wanted): BullMQ 6's `BackendFactory`,
the Postgres backend, and `bullmq-otel` telemetry.

## Open questions, to settle before or during the work

- **Existing Redis data. Settled.** I seeded a scratch Redis db with
  `add({ repeat })` on BullMQ 5.0.0, 5.79.2 (the oldest this repo ever
  depended on) and 5.81.5, then read it with 6.3.16. The 5.79.2 and 5.81.5
  data list as schedulers under a hashed key. A 6.3.16 worker processed the
  promoted occurrence and rescheduled the next one in the job's zone. The
  5.0.0 data (`name:::tz:pattern` keys) makes `getJobSchedulers()` throw
  "Legacy repeatable job metadata is not supported in BullMQ v6". No
  Tulipes release shipped such a BullMQ, and MIGRATING says so.
- **Runtime rejection of `repeat` in `add()`. Done.** It throws an error
  naming `schedule()`, and the integration test covers it.
- **A `tulipes migrate` step. Not done.** A codemod would need a scheduler
  id that only the app can choose, so the MIGRATING entry covers it.

## Acceptance

- `pnpm install --frozen-lockfile` prints no deprecation warning for
  cron-parser; `pnpm why cron-parser` shows only 5.x.
- `pnpm typecheck`, `pnpm test:types`, and `pnpm test:coverage` with
  `TEST_MONGO_URI`, `TEST_REDIS_URL` and `REQUIRE_INTEGRATION_TESTS=1`:
  pass, coverage no lower than 0.13.1's 94.84 / 91.37 / 94.08 / 95.92.
- `pnpm example` boots in backend and worker mode, a hello job is processed,
  and shutdown is clean (drain/close order unchanged).
- `artifacts.mjs prepare` + `verify` pass, plus the scaffold smoke for the
  production preset with queues.
- `failure-smoke.mjs` (Docker) if available, since it exercises Redis loss.
  If it isn't run, say so in the evidence.
- Evidence recorded here, local and CI kept apart, before the commit.

## Done

- `packages/bullmq`: `bullmq ^6.3.16` (lockfile 6.3.16, cron-parser 5.10.2).
  `add()` drops the repeat path and throws if `repeat` is passed. Version
  0.3.0.
- Tests: the legacy `add({ repeat })` assertion now expects that error; the
  close test reaches the raw client through `getBackend().client` (BullMQ 6
  removed `Queue#client`). New `packages/bullmq/tests/queues.test-d.ts`
  makes `repeat` on `add()` and `utc` on `schedule()` type errors.
- `@tulipes/cli` 0.4.2: its packed `templates/versions.json` pins
  `@tulipes/bullmq` 0.3.0, so its bytes changed.
- Docs: MIGRATING ("@tulipes/bullmq 0.3.0"), CHANGELOG `[Unreleased]`,
  bullmq README, queues design doc.

## Evidence

Local: this Mac, 2026-10-31, Node 24.14.0, pnpm 10.28.0, MongoDB and Redis
on 127.0.0.1, no Docker. Not yet run in CI.

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | no deprecation warning; `pnpm why cron-parser` lists only 5.10.2 |
| `pnpm typecheck`, `pnpm test:types` | pass |
| `pnpm test:coverage` (MongoDB, Redis, `REQUIRE_INTEGRATION_TESTS=1`) | 40 files, 413 passed; 94.84 / 91.37 / 94.08 / 95.92, identical to 0.13.1. Run before and after the version bumps |
| bullmq integration tests alone | 2 files, 14 passed, none skipped |
| `example/` backend + worker | both boot ("3 consuming · bullmq"); `POST /api/v1/greetings/world/use` returned 202; the worker logged `counted greeting`; `times_used` went 1 → 2; both exited 0 on SIGTERM |
| `artifacts.mjs prepare` + `verify` | eight archives verify; `bullmq-0.3.0` declares `bullmq ^6.3.16`; `cli-0.4.2`'s `versions.json` pins `@tulipes/bullmq` 0.3.0 |
| `scaffold-smoke.mjs <archives> production` | **fails at the dependency audit**: zod GHSA-mrhx-c7xc-m3w5 (high, `<4.6.6`) against the template's `zod ^3.25` → 3.25.76. That is unrelated to this change (see backlog) |
| same smoke, scratch copy with the audit made non-fatal | packed install, generated types, tests, specs, backend/shutdown, mcp and worker passed in 79.2 s |

Not run: `failure-smoke.mjs` and `ingress-smoke.mjs` (need Docker), the
`--no-queues --no-sockets` and minimal scaffold variants (CI runs them),
`upgrade-smoke.mjs`.

## Backlog found on the way: resolved

- zod GHSA-mrhx-c7xc-m3w5: fixed in `6b99a0d` (apps on `zod ^4.6.6`, core on
  `zod/v4`). The production smoke passes its real audit gate.
- `new-module.ts` provider ranges: fixed in `aa9712c`.
- Publication path: bundled into core 0.13.2, which republishes all eight
  archives. See the release record.
