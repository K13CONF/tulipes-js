# Release — core 0.13.2, BullMQ 6 and zod 4.6.6

Status: **published on 2026-10-31** to npm's `latest` tag, from `v0.13.2`
on `ace4b14` (PR #39). See Publication below.

## Scope

- **`@tulipes/bullmq` 0.3.0: BullMQ 6** (`^6.3.16`, locked to 6.3.16). This
  removes the `cron-parser@4.9.0` deprecation warning on install.
  `ctx.queues.add()` loses `repeat`, which `schedule()` replaces. Breaking
  for that provider only. Plan, compatibility tests and evidence:
  [`bullmq-6-plan.md`](./bullmq-6-plan.md).
- **zod GHSA-mrhx-c7xc-m3w5** (high, `<4.6.6`, published 2026-10-01). The
  reference app, and therefore the production preset, plus the minimal
  preset depend on `zod ^4.6.6`. Core accepts `^3.25 || ^4.6.6` and imports
  `zod/v4` itself, so apps on 3.25 keep booting. A `manifestParse` error map
  keeps manifest errors worded `Required`.
- **body-parser GHSA-27r3-jxmh-p828** (high, `>=2.0.0 <2.4.0`, published
  2026-10-23, after 0.13.1): the lockfile moves to body-parser 2.4.0 under
  express 5.2.1, which already allows `^2.2.1`. Fresh installs of
  generated apps get it with no range change.
- **List queries** in the production preset (`@app/core`): `listQuery(policy)`
  with `toMongoose`/`runQuery`, the reference `GET /users/directory`
  (`users:bo:list`) and skill `tulipes-list-query`. Design and decisions:
  [`list-query-design.md`](../design/list-query-design.md). This adds the
  reference app's 39th endpoint (11 in `bo`) and regenerates
  `example/docs/{openapi,collection}.json`, which had also been missing the
  0.13 agents-run endpoints. The query time limit is app-wide
  (`config.pagination.maxTimeMs`, set at boot by `list-query.bootstrap.ts`)
  and overridable per call (`3f1b985`).
- **`tulipes new module`** now writes the provider versions the CLI
  scaffolds with, not `^0.1.1`.
- **Test fix:** provider-matrix's "starts nothing" test counted Redis
  clients server-wide and raced with parallel files. It now counts this
  process's ioredis connects. A mutant that does connect fails it.
- **Packages:** core `0.13.2`, `@tulipes/cli` `0.4.2`, `@tulipes/mcp` `0.2.2`,
  `@tulipes/spec` `0.4.3`, `@tulipes/mongoose` `0.2.4`, `@tulipes/bullmq`
  `0.3.0`, `@tulipes/testing` `0.1.4`, `@tulipes/socket.io` `0.1.6`: eight
  archives, for dist-tag `latest`. Peer ranges are unchanged and already
  admit 0.13.2.

## Evidence

Local: this Mac, 2026-10-31, Node 24.14.0, pnpm 10.28.0, MongoDB and Redis
on 127.0.0.1, Docker not running. **No CI run yet**: the branch isn't
pushed. Everything below used the committed harnesses unmodified, on the
final versions.

Re-run after the list-query work landed (same machine and date; after
`3f1b985`: CI test job 485 passed, example suite 181 passed, production
smokes and upgrade pass again):

| CI job | Local result |
|---|---|
| tests | 42 files, 484 passed; 94.75 / 90.07 / 94.83 / 95.88; the query helpers' grammar, policy and stages above their own 90/85 floors |
| example suite (`example/`, services) | 15 files, 179 passed, 8 skipped (the live-model evals, which need `AGENTS_LIVE=1`) |
| pack, workspace audit | eight archives verify; no high/critical |
| minimal, production `--offline-only`, composition, upgrade | pass |
| production (MongoDB, Redis) | pass, 84.3 s; the generated app's own suite ran 15 files, 179 passed |

Docker harness, 2026-10-31, Docker 29.5.2, on the `3f1b985` archives:
`failure-smoke.mjs` passed with 12 observations: primary SIGKILLed
mid-refresh (client saw 200), election to :27102, rotated token 200 and
pre-failure replay 401, re-login 200; Redis down: limited endpoint 503,
unlimited 200, limiter back after ~1 s; shutdown with a member down exits
0. Its Redis outage exercises the rate limiter's client; BullMQ 6 under a
Redis outage is not observed by any harness. `ingress-smoke.mjs` not run.

Before it:

| CI job | Local result |
|---|---|
| tests: frozen install, `test:types`, `test:coverage` (`REQUIRE_INTEGRATION_TESTS=1`) | pass; 40 files, 413 passed; 94.84 / 91.37 / 94.08 / 95.92, the same as 0.13.1. 3 consecutive green full runs after the deflake |
| tests: example `sync` + `typecheck`, agent-file diffs | pass; identical |
| pack: `artifacts.mjs prepare` + `verify`, workspace audit (`--environment production`) | eight archives verify; audit: no high/critical (fast-uri and qs findings are moderate/low) |
| minimal smoke | pass, 14.6 s |
| production `--offline-only` | pass |
| composition `--no-queues --no-sockets --offline-only` | pass |
| upgrade (cli 0.2.0 / core 0.11.0 → these archives) | pass: refused, migrated with `0.12` and `0.13`, installed, typechecked, booted to its provider |
| production (MongoDB, Redis) | pass, 79.6 s, including the dependency audit, backend/shutdown, mcp and worker |

Also checked by hand: the packed CLI 0.4.2 run as `tulipes new module
billing` writes `@tulipes/mongoose ^0.2.4`, `@tulipes/bullmq ^0.3.0` and
`@tulipes/socket.io ^0.1.6`. The reference app's backend and worker on
BullMQ 6 processed a real job end to end (in the plan).

Not run: `ingress-smoke.mjs` (Docker; nothing it exercises changed). CI covers Node
24.0.0; only 24.14.0 was used here, and macOS was the only minimal OS.

## Before publishing

1. Land the remaining changes, then rerun the table above.
2. Run `failure-smoke.mjs` with Docker up; it's the one harness that takes
   Redis away from BullMQ 6.
3. Set the CHANGELOG date. Push, open the PR, and wait for green CI.
   Merge, then tag `v0.13.2` per [`releasing.md`](../releasing.md).

## Publication

- PR #39's first CI runs failed before any project code ran: GitHub's
  `ubuntu-24.04` image (20261025) moved to kernel 7.0.0-azure, where every
  `mongo:8` image refuses to start (SERVER-121912; MongoDB's fixed builds
  start again on 7.0.14+). `71b2299` moves the two jobs that start MongoDB
  (`tests`, `production`) to `ubuntu-22.04` (kernel 6.8) with a note to
  return to `ubuntu-latest` once the kernel reaches 7.0.14. CI then passed
  every job on both the push and the pull-request run.
- Merged on GitHub as `ace4b14`. Its author is the account's noreply
  address, not `support@k13conf.com` (a GitHub merge takes the account's
  identity); the commits it merges carry the right author. Left as is:
  correcting it means rewriting `master` under a published tag.
- Tag `v0.13.2` on `ace4b14`. The publish workflow re-ran every verify job
  and published the eight archives
  ([run 41211429673](https://github.com/K13CONF/tulipes-js/actions/runs/41211429673)).
- Registry: each of the eight versions' `dist.integrity` matches the
  digest in the run's `manifest.json` (commit `ace4b14`). `latest` is core
  0.13.2, cli 0.4.2, mcp 0.2.2, spec 0.4.3, mongoose 0.2.4, bullmq 0.3.0,
  testing 0.1.4 and socket.io 0.1.6. Metadata was served within 70 s; the
  socket.io 0.1.6 tarball returned 404 for about 5 minutes after
  publication, then 200, and its bytes match the integrity.
- Registry smokes, run locally on the run's archives: minimal passed in
  14.4 s; production, against local MongoDB and Redis, passed in 82.8 s,
  the generated app's suite 15 files, 181 passed. The first production
  attempt failed on that socket.io 404 and passed once it was served.

