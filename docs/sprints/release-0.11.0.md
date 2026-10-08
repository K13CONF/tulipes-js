# Release — core 0.11.0, the 0.11 line stable

Status: **published** on 2026-10-08 from `f5bf21c` (merge of #31, after #30), tag `v0.11.0`, publish run [37843899495](https://github.com/kemora13conf/bp-backend-express/actions/runs/37843899495): `validate-release`, the whole verification matrix and `publish` green; eight uploads with `--tag latest`. Owning items: 0.11-S08 (the line),
S09 (before stable) and S10 (actions only) in [the 0.11 plan](./0.11-plan.md).
Publication follows [the release procedure](../releasing.md): a reviewed PR
with green CI, then the `v0.11.0` tag on its merge commit, which publishes
every package to `latest`.

## Scope and acceptance

- Everything the two candidates carried, plus since rc.2: the agent surface
  is actions only, declared apart from routes (S10, `7120d25`); the file
  settings store polls as a floor and `update`'s no-change line says what
  it compared (`96f64d3`).
- Versions: core `0.11.0`, `@tulipes/cli` `0.2.0`, `@tulipes/spec` `0.3.2`,
  `@tulipes/mongoose` and `@tulipes/bullmq` `0.2.0`, `@tulipes/socket.io`
  `0.1.2`, `@tulipes/mcp` and `@tulipes/testing` `0.1.0`. Eight archives,
  all republished. Peer ranges tightened to what works: the providers, mcp
  and testing require core `^0.11.0` (provider contract 2 has no
  `runBootstrap`, so a 0.10 core cannot drive them); spec accepts
  `^0.10.0 || ^0.11.0`; the CLI's optional spec peer is `^0.3.2`. The
  minimal template is on workspace ranges, so the generator pins these.
- npm dist-tag `latest` for all eight. That also moves `@tulipes/mcp` and
  `@tulipes/testing` off the rc.1 `latest` their first publish left.
- `CHANGELOG.md` folds rc.1 and rc.2 into one `0.11.0` section;
  `MIGRATING.md` heads every 0.11 section `0.11.0` and opens with the path
  from a candidate (`tulipes migrate 0.11` again, which on a candidate app
  rewrites only the agent files); `docs/support.md` makes 0.11 the current
  line and 0.10 the previous stable; the agent surface and `@tulipes/mcp`
  stay experimental.
- Migration from 0.10: `tulipes migrate 0.11` then `tulipes config:import`
  (the upgrade harness runs exactly that), the rest by `MIGRATING.md`.

## Evidence

Local runs are on macOS (Darwin 25.2), Node 24.14.0, pnpm 10.28.0, with
MongoDB 7.0 and Redis on localhost and Docker 29.5.2 (Docker Desktop,
reached through its `docker.raw.sock`), on 2026-10-08. CI is
[run 37841490225](https://github.com/kemora13conf/bp-backend-express/actions/runs/37841490225) on PR [#31](https://github.com/kemora13conf/bp-backend-express/pull/31),
head `d9b1b2a`, Node 24.21 and 24.0.0 on Ubuntu 24.04 with MongoDB 8 and
Redis 7 service containers, macOS for the second minimal entry; the
push-triggered run on the same head (37841433109) passed identically.

| Check | Local | CI |
|---|---|---|
| `pnpm install --frozen-lockfile` | pass | pass on every job |
| `pnpm typecheck`, `pnpm test:types` | pass, on the stable ranges | pass on both tests jobs ([tests 24](https://github.com/kemora13conf/bp-backend-express/actions/runs/37841490225/job/113531688297)) |
| `pnpm test` with `REQUIRE_INTEGRATION_TESTS=1` | 33 files, 277 passed, 0 skipped (on `7120d25`, before the version bump) | 277 passed, 0 skipped, with services, on [tests 24](https://github.com/kemora13conf/bp-backend-express/actions/runs/37841490225/job/113531688297) and [24.0.0](https://github.com/kemora13conf/bp-backend-express/actions/runs/37841490225/job/113531688153); coverage thresholds met (the job is green) |
| Reference app: `pnpm typecheck`, `pnpm test` with services | typecheck pass; 7 files, 43 passed | pass inside the production smoke ([production](https://github.com/kemora13conf/bp-backend-express/actions/runs/37841490225/job/113532872447)) |
| `tulipes agent manifest --role admin` on the reference app | two actions, no `transport` | — |
| `scripts/artifacts.mjs prepare` + `verify` | eight archives verified | pass ([pack](https://github.com/kemora13conf/bp-backend-express/actions/runs/37841490225/job/113532692763)) |
| `scaffold-smoke.mjs minimal` | pass, 12.7 s | pass on [Ubuntu](https://github.com/kemora13conf/bp-backend-express/actions/runs/37841490225/job/113532872619) and [macOS](https://github.com/kemora13conf/bp-backend-express/actions/runs/37841490225/job/113532872587) |
| `scaffold-smoke.mjs production --offline-only`, `--no-queues --no-sockets --offline-only` | pass, both (network connections denied) | pass ([offline](https://github.com/kemora13conf/bp-backend-express/actions/runs/37841490225/job/113532872588), [composition](https://github.com/kemora13conf/bp-backend-express/actions/runs/37841490225/job/113532872438)) |
| `scaffold-smoke.mjs production` (online: backend, worker, login, PM2) | pass, 64.1 s (packed install, generated types, tests, specs, backend/shutdown and worker) | pass ([production](https://github.com/kemora13conf/bp-backend-express/actions/runs/37841490225/job/113532872447)) |
| `upgrade-smoke.mjs` (0.10.1 app → `migrate 0.11` + `config:import`) | pass, onto the eight 0.11.0 archives | pass ([upgrade](https://github.com/kemora13conf/bp-backend-express/actions/runs/37841490225/job/113532872468)) |
| `ingress-smoke.mjs` | pass, 9/9 checks, [recorded](../design/ingress-evidence.md) (the harness's probe module updated to the 0.11 shape) | not in the matrix |
| `failure-smoke.mjs` (incl. settings propagation) | pass, all twelve scenarios, [recorded](../design/failure-evidence.md) | not in the matrix |
| Production preset cold start on Node 24 | median 532 ms wall to the banner, `ready in` 339 ms, five runs, [recorded](../design/0.11-measurements.md) | the matrix does not measure it |

Source under release: `342bba4`, `fa1925c`, `3e08208`, `002f15e`, `da52b5e`
(S09, rc.2), `6b130fd` (S10 design), `96f64d3`, `7120d25` (S10), and the
versions commit that adds this file. PR #30 (the rc.2 post-publication
record, docs only) is open separately.

## Steps left for the release owner

1. ~~Review and merge PR #30 (docs), then the release PR #31.~~ Done:
   #30 as `15c7b31`, #31 as `f5bf21c` after one conflict resolution in the
   plan's backlog list (`471bc8a`) and a green rerun on it.
2. ~~With Docker running: the two Docker harnesses.~~ Done locally, both
   recorded in `docs/design/`. The plan's cross-replica revocation case is
   not in `failure-smoke.mjs`; the auth cache lives in the shared Redis and
   every revocation path deletes the entry (security model, S08b), so the
   case is a verification of that design, not a gap in it.
3. ~~Tag `v0.11.0` on the merge commit.~~ Done.
4. ~~Post-publication checks.~~ Below.

## Post-publication checks (2026-10-08, macOS, Node 24.14.0)

- **Visibility.** All eight versions answered on the registry 278 s after
  the run finished; nothing was republished.
- **Digests.** The run's `release-packages` artifact downloads,
  `scripts/artifacts.mjs verify` accepts it against `f5bf21c`, and every
  package's registry `dist.integrity` equals the manifest's.
- **Dist-tags.** `latest` is the stable version on all eight; `next` stays
  at rc.2. `@tulipes/mcp` and `@tulipes/testing` no longer have an rc on
  `latest`.
- **Registry smokes** (`--registry`, installing from npm at exactly the
  manifest's versions): production `--offline-only` and
  `--no-queues --no-sockets --offline-only` passed with network connections
  denied. The minimal and online production variants could not run here:
  their start step is `pnpm dev` (`node --watch`), and on this machine
  `node --watch` on a one-line script fails with `EMFILE: too many open
  files, watch` — file watching is exhausted by the other development
  servers and Docker Desktop's shared folders, which were not running when
  the rc.2 registry smokes passed earlier the same day. The app is not in
  question: the publish run's own `production` job booted the packed
  archives (backend, worker, login, PM2), and the registry tarballs have
  those archives' digests byte for byte.
- **The published CLI's `update`, in a sandbox** (`@tulipes/cli@0.2.0`
  installed into a scratch prefix, stub `npm`/`pnpm`/`yarn` on `PATH`,
  the live registry): on an rc.2 app it raised core, mongoose and the CLI
  devDependency to the stable ranges in the root and the module
  (`@tulipes/core ^0.11.0, @tulipes/mongoose ^0.2.0, @tulipes/cli ^0.2.0`)
  and started the install; on a 0.11.0 app it reported "app already at or
  ahead of @tulipes/core@0.11.0" and changed nothing. The maintainer's
  global CLI (0.2.0-rc.1) was not touched.
