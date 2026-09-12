# Service failure evidence (S15.3)

Recorded 2026-09-12 with `scripts/failure-smoke.mjs` against packed archives
built from this branch, Node 24.14.0, macOS arm64, Docker 29.5.2. Raw results in
git-ignored `reports/failure-smoke/` (`observations.json`, the app's own output,
command logs).

## What was run

A generated **production** app against a disposable **three-node MongoDB replica
set** (`rs0`) and its own Redis. All three `mongod` processes run in one
container on distinct ports published 1:1, so every member is addressable as
`127.0.0.1:<port>` both from inside the container, where they replicate to each
other, and from the host, where the app connects. The app uses the full host
list with `?replicaSet=rs0` and no `directConnection`, so the driver must
discover the topology and follow an election.

Then the services are taken away: the primary is `SIGKILL`ed mid-refresh (the
surviving members are verified still answering), and Redis is stopped and
restarted under the rate limiter.

## Observations

| Scenario | Observed |
|---|---|
| Primary killed during a majority-acknowledged refresh rotation | the client received **HTTP 200** — the driver completed the rotation against the new primary |
| Election | a surviving member became primary (`127.0.0.1:27102`) |
| The rotated token afterwards | **200** — the rotation that the client was told succeeded did survive the election |
| Replaying the pre-failure token afterwards | **401** — reuse is still detected across the election, and by design it revokes the device family |
| Login after the election | **200** |
| Redis down, rate-limited endpoint | **503** `RATE_LIMIT_UNAVAILABLE` — the limiter fails closed, as documented |
| Redis down, endpoint outside the limiter | **200** — the cache degrades to a miss |
| Redis restarted | the limiter resumed within ~1 s |
| SIGTERM with a replica-set member still down | exit code 0 in ~16 ms |

What this does **not** establish: that an unacknowledged write did not commit.
The harness deliberately records what a client can observe afterwards rather
than claiming a rollback — a write whose acknowledgment was lost may still have
been applied, and the refresh design is safe under either outcome because the
next use of either token is checked against the stored state.

## Findings, all three fixed on this branch

**F3 — a replica-set `MONGO_URI` could not boot the app at all.** The `url`
variable type validated with WHATWG `new URL()`, which rejects the multi-host
form every self-hosted replica set uses
(`mongodb://a:27017,b:27017/db?replicaSet=rs0` — the comma inside the authority
makes the port unparseable). The app refused to start with *"is not a valid
URL"* before touching the database, so the single most common production
MongoDB topology was unusable. `url` now accepts a comma-separated host list
when **every** host parses on its own, and still rejects a typo'd scheme, an
empty host or a bad port. Regression test in `packages/core/tests/contracts.test.ts`.

**F4 — a failed boot could be reported as a `TypeError` from Socket.IO.** The
sockets provider creates its server unattached during acquisition and attaches
it to the HTTP server before `listen()`; a boot that failed in between still
disposes the resource, and `io.close()` on a server that never attached throws
`Cannot read properties of undefined (reading 'close')` — which replaced the
real boot failure in the output. `close()` is now a no-op before `attach()`.
Regression test in `packages/socket.io/tests/sockets.integration.test.ts`.
Introduced by the S11 design; found by this harness.

**F5 — a Redis outage took down the entire API.** The generated sys `core`
module mounts global middleware that reads the app cache on **every** request.
`RedisCache` let driver errors escape, and its client used ioredis defaults, so
an outage meant 20 retries and then `MaxRetriesPerRequestError` reaching the
error handler: **every endpoint answered 500**, including ones that never use
Redis. A cache is best effort, so the generated cache now fails fast
(`maxRetriesPerRequest: 1`, `enableOfflineQueue: false`) and degrades every
operation to "no cache", reporting at most once every 30 s. After the fix the
same outage leaves non-limited endpoints at 200 and the limiter at its
documented 503.

## What a pilot still has to do

Multi-replica behaviour, sustained load during an election, an actual backup and
restore, and failure of the pilot's own topology (a managed cluster fails over
differently from three processes in a container). Those are S15.4–S16.6 and need
the environment listed in the [Sprint 06 plan §2](../sprints/production-readiness-06.md#2-blocked-on-inputs-what-to-provide).
