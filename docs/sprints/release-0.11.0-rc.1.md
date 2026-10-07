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
`redis://127.0.0.1:6399/3`, no MongoDB and no Docker. CI runs are what the
release PR must produce; none has run on this tree yet.

| Check | Local | CI |
|---|---|---|
| `pnpm install --frozen-lockfile` | lockfile committed with every change set | pending |
| `pnpm typecheck`, `pnpm test:types` | pass on the release tree | pending |
| `pnpm test` | 249 passed, 16 skipped (the MongoDB suites: mongoose provider matrix and database, the Mongo settings store) | pending — CI refuses skips |
| `pnpm test:coverage` thresholds | not run | pending |
| Reference app suite (`example`, one file per module on `@tulipes/testing`) | typechecks; not run (MongoDB) | pending |
| `scripts/artifacts.mjs prepare` + `verify` | eight archives verified | pending |
| `scaffold-smoke.mjs minimal` (packed; generated tests, specs, backend/shutdown on node) | pass | pending (Ubuntu and macOS) |
| `scaffold-smoke.mjs production --offline-only`, `--no-queues --no-sockets --offline-only` | pass | pending |
| `scaffold-smoke.mjs production` (online: backend, worker, login, PM2 on node) | not run (services) | pending |
| `upgrade-smoke.mjs` (0.10 app → `migrate 0.11` + `config:import`) | pass | pending |
| `ingress-smoke.mjs`, `failure-smoke.mjs` (incl. the settings propagation scenario) | not run (Docker) | pending |
| `scripts/audit.mjs` | pass on the S00 tree; rerun pending after the new packages | pending |
| Cold start without tsx | minimal preset 343 ms vs 577 ms median, [recorded](../design/0.11-measurements.md) | production preset on Node 24 pending |

Source under release: the branch's head commit at the time of the release PR;
the change sets are `5e7ad9b` (S00), `07437d9` (S06.1), `fae0b6a` (S01),
`b02bd4d` (S03), `c815a6c` (S03.4), `e25323d` (S04), `ab59259` (S02),
`d8c6c4c` (S05), `e80f90a` (S06.2), `bc2e4bb` (S06.3/S06.4), `b3aa547` (S07)
and the S08 commit that adds this file.

## Steps left for the release owner

1. Open the PR to the default branch; let the full verification matrix run on
   Node 24 with services; fill the CI column above from its jobs and record
   the coverage numbers.
2. Decide the registry preflight: `next` currently holds the 0.10 line; the
   first publishes of `@tulipes/mcp` and `@tulipes/testing` will receive
   `latest` from npm regardless of `--tag` (record it, as for 0.10.0-rc.3).
3. Tag `v0.11.0-rc.1` on the merged commit; the gated workflow verifies the
   eight archives and publishes; then the registry digest check and the
   `--registry` smokes for both presets.
