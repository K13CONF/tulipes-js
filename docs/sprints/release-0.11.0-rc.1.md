# Release — core 0.11.0-rc.1, the 0.11 line as a candidate

Status: **prepared, not published**. The tree on branch
`claude/blissful-ride-qonx35` carries the versions, changelog and migration
notes; publication needs the release owner's PR, CI, tag and authorization
under [the release procedure](../releasing.md). Owning item: 0.11-S08.2 in
[the 0.11 plan](./0.11-plan.md).

## Scope and acceptance

- Core `0.11.0-rc.1` (breaking: three-file module root with the env contract
  in `package.json`, plain routes and one inspection, settings declarations
  with the store seam, bootstrap as the only lifecycle, provider contract 2,
  the agent surface, generated model and job types, no tsx, pnpm),
  `@tulipes/cli` `0.2.0-rc.1` (`init` copies the reference app, `migrate 0.11`,
  `config:import`, `config:check`, `agent manifest`, `--offline`/`--runtime`
  gone), `@tulipes/spec` `0.3.2-rc.1` (core peer range), `@tulipes/mongoose`
  `0.2.0-rc.1` (the settings provider at `/settings`, `KnownModels`),
  `@tulipes/bullmq` `0.2.0-rc.1` (`jobs` export, typed `add`, `KnownJobs`),
  `@tulipes/socket.io` `0.1.2-rc.1` (contract 2), and the first
  `@tulipes/mcp` and `@tulipes/testing` at `0.1.0-rc.1`. npm dist-tag `next`.
- Eight archives. Every workspace package is republished because packing
  rewrites its core dependency to the concrete version.
- Migration: `tulipes migrate 0.11` then `tulipes config:import` on an app
  generated on 0.10 (the upgrade harness runs exactly that), the rest by the
  sections of `packages/core/MIGRATING.md`.
- The generated apps run on node without a loader; both presets pin the
  candidate versions (`^0.11.0-rc.1`, `^0.2.0-rc.1`, `^0.3.2-rc.1`,
  `^0.1.0-rc.1`), verified by generating the minimal preset from the source
  checkout.

Not part of this candidate: a production pilot, the measurements CI alone can
take (production cold start on Node 24, the per-file test boot time), stable
0.11 claims, repository visibility.

## Evidence

Local runs are on the development container of 2026-10-07 — Linux 6.18,
Node 22.22.0 (type stripping on by default; the packages require 24, which
pnpm reports as a warning), pnpm 10.28.0, a local Redis at
`redis://127.0.0.1:6399/3`, no MongoDB and no Docker. The CI column is the
`Verify packages` matrix of [run 37674727715](https://github.com/kemora13conf/bp-backend-express/actions/runs/37674727715) on the release PR
([#25](https://github.com/kemora13conf/bp-backend-express/pull/25)), head
`1cc3d20`, Node 24.21.0 on the `24` matrix entry and 24.0.0 on the pinned one, Ubuntu 24.04
runners with MongoDB 8 and Redis 7 service containers, macOS for the second
minimal entry; the push-triggered run on the same head ([37674721763](https://github.com/kemora13conf/bp-backend-express/actions/runs/37674721763))
passed identically. The two runs before it, on `530a9e8`, were red on the
production smoke alone, with the three suite defects `1cc3d20` fixes. The
run on master's merge commit `4d3a3cf` ([37676275747](https://github.com/kemora13conf/bp-backend-express/actions/runs/37676275747))
failed one test on the `24` entry only: the log stream's duration deadline
started when the request entered `open()`, so a 100 ms duration on a loaded
runner expired during the authorization round trip and the stream answered
401 instead of `ready`. The duration now starts at the ready frame and the
test's margins are wider; that fix is the follow-up PR whose merge carries
the tag.

| Check | Local | CI |
|---|---|---|
| `pnpm install --frozen-lockfile` | lockfile committed with every change set | pass on every job ([tests 24](https://github.com/kemora13conf/bp-backend-express/actions/runs/37674727715/job/112975165686), [tests 24.0.0](https://github.com/kemora13conf/bp-backend-express/actions/runs/37674727715/job/112975165358)) |
| `pnpm typecheck`, `pnpm test:types` | pass on the release tree | `test:types` pass on both tests jobs; the reference app syncs and typechecks there too ([tests 24](https://github.com/kemora13conf/bp-backend-express/actions/runs/37674727715/job/112975165686)) |
| `pnpm test` | 249 passed, 16 skipped (the MongoDB suites: mongoose provider matrix and database, the Mongo settings store) | 265 passed, 0 skipped, 32 files, with services (`REQUIRE_INTEGRATION_TESTS=1`), 69.3 s on [tests 24](https://github.com/kemora13conf/bp-backend-express/actions/runs/37674727715/job/112975165686), 54.5 s on 24.0.0 |
| `pnpm test:coverage` thresholds | not run | statements 88.96 %, branches 81.79 %, functions 90.81 %, lines 90.75 % against 77/62/82/79 ([tests 24](https://github.com/kemora13conf/bp-backend-express/actions/runs/37674727715/job/112975165686)) |
| Reference app suite (`example`, one file per module on `@tulipes/testing`) | typechecks; not run (MongoDB) | pass inside the production smoke (the generated app is `example/`), after `1cc3d20` ([production](https://github.com/kemora13conf/bp-backend-express/actions/runs/37674727715/job/112976316717)) |
| `scripts/artifacts.mjs prepare` + `verify` | eight archives verified | eight archives packed and uploaded as `release-packages`, verified by every consumer job ([pack](https://github.com/kemora13conf/bp-backend-express/actions/runs/37674727715/job/112976052753)) |
| `scaffold-smoke.mjs minimal` (packed; generated tests, specs, backend/shutdown on node) | pass | pass on [Ubuntu](https://github.com/kemora13conf/bp-backend-express/actions/runs/37674727715/job/112976316992) and [macOS](https://github.com/kemora13conf/bp-backend-express/actions/runs/37674727715/job/112976316692) |
| `scaffold-smoke.mjs production --offline-only`, `--no-queues --no-sockets --offline-only` | pass | pass ([offline](https://github.com/kemora13conf/bp-backend-express/actions/runs/37674727715/job/112976316830), [composition](https://github.com/kemora13conf/bp-backend-express/actions/runs/37674727715/job/112976316785)) |
| `scaffold-smoke.mjs production` (online: backend, worker, login, PM2 on node) | not run (services) | "packed install, generated types, tests, specs, backend/shutdown and worker passed in 80.4s" ([production](https://github.com/kemora13conf/bp-backend-express/actions/runs/37674727715/job/112976316717)) |
| `upgrade-smoke.mjs` (0.10 app → `migrate 0.11` + `config:import`) | pass | pass from cli 0.1.1 / core 0.10.1 ([upgrade](https://github.com/kemora13conf/bp-backend-express/actions/runs/37674727715/job/112976316845)) |
| `ingress-smoke.mjs`, `failure-smoke.mjs` (incl. the settings propagation scenario) | not run (Docker) | not part of the matrix (Docker harnesses); the release owner's step |
| `scripts/audit.mjs` | pass on the S00 tree; rerun pending after the new packages | "no high/critical findings" on the release tree ([pack](https://github.com/kemora13conf/bp-backend-express/actions/runs/37674727715/job/112976052753)) |
| Cold start without tsx | minimal preset 343 ms vs 577 ms median, [recorded](../design/0.11-measurements.md) | not measured by the matrix; the production preset on Node 24 stays open in the measurements file |

Source under release: the branch's head commit at the time of the release PR;
the change sets are `5e7ad9b` (S00), `07437d9` (S06.1), `fae0b6a` (S01),
`b02bd4d` (S03), `c815a6c` (S03.4), `e25323d` (S04), `ab59259` (S02),
`d8c6c4c` (S05), `e80f90a` (S06.2), `bc2e4bb` (S06.3/S06.4), `b3aa547` (S07),
`3c0bb62` (S08, this file), then the two CI-driven fixes `530a9e8` (two
MongoDB-only tests) and `1cc3d20` (three reference-suite defects), merged
as `4d3a3cf`; the log stream duration fix follows in its own PR, and the
tag goes on that PR's merge commit.

## Steps left for the release owner

1. ~~Open the PR to the default branch; let the full verification matrix run on
   Node 24 with services; fill the CI column above from its jobs and record
   the coverage numbers.~~ Done: PR #25, run 37674727715 green on `1cc3d20`,
   CI column and coverage above; the log stream duration fix after the
   master run.
2. ~~Decide the registry preflight.~~ Recorded: `@tulipes/mcp` and
   `@tulipes/testing` were first publishes (each name held a `0.0.0-stage`
   placeholder), so npm gave them `latest` as well as `next`; every other
   package has `next` on the candidate and `latest` on the 0.10 line.
3. ~~Tag `v0.11.0-rc.1` on the merged commit~~ Done by the release owner on
   `f2e0a21`, the merge of #26 (the log stream duration fix after the
   master run). Publish run
   [37683814565](https://github.com/kemora13conf/bp-backend-express/actions/runs/37683814565):
   `validate-release`, the full verification matrix and `publish` all green;
   the eight archives went up with `--tag next`.

## Post-publication checks (2026-10-07, after the publish run)

- **Digests.** The eight tarballs downloaded from the registry hash to the
  registry's `dist.integrity`, and their SHA-1 shasums equal the ones the
  publish job printed for each archive it uploaded; the run's
  `release-packages` artifact itself is not reachable from the development
  container (its blob host is denied), so the archive manifest was rebuilt
  from the registry tarballs and `scripts/artifacts.mjs verify` accepts it
  (identity, license, exports, required files, core without drivers).
- **Dist-tags.** As recorded under step 2 above.
- **Registry smokes** (`scaffold-smoke.mjs … --registry`, installing from
  npm at exactly the manifest's versions, refusing local archives):
  minimal passed in 14.9 s (generated types, tests, specs, backend/shutdown
  on node); production `--offline-only` and
  `--no-queues --no-sockets --offline-only` passed with network connections
  denied. The online production variant needs MongoDB and was not run
  here; the publish run's own `production` job covered it from the packed
  archives.
