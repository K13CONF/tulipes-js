# Release — core 0.11.0, the 0.11 line stable

Status: **prepared, not published**. Owning items: 0.11-S08 (the line),
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
MongoDB 7.0 and Redis on localhost, on 2026-10-08. No Docker: Docker
Desktop's daemon did not start on this machine, so the two Docker
harnesses are the release owner's step (below).

| Check | Local | CI |
|---|---|---|
| `pnpm install --frozen-lockfile` | pass | pending |
| `pnpm typecheck`, `pnpm test:types` | pass, on the stable ranges | pending |
| `pnpm test` with `REQUIRE_INTEGRATION_TESTS=1` | 33 files, 277 passed, 0 skipped (on `7120d25`, before the version bump) | pending |
| Reference app: `pnpm typecheck`, `pnpm test` with services | typecheck pass; 7 files, 43 passed | pending (inside the production smoke) |
| `tulipes agent manifest --role admin` on the reference app | two actions, no `transport` | — |
| `scripts/artifacts.mjs prepare` + `verify` | eight archives verified | pending |
| `scaffold-smoke.mjs minimal` | pass, 12.7 s | pending |
| `scaffold-smoke.mjs production --offline-only`, `--no-queues --no-sockets --offline-only` | pass, both (network connections denied) | pending |
| `scaffold-smoke.mjs production` (online: backend, worker, login, PM2) | pass, 64.1 s (packed install, generated types, tests, specs, backend/shutdown and worker) | pending |
| `upgrade-smoke.mjs` (0.10.1 app → `migrate 0.11` + `config:import`) | pass, onto the eight 0.11.0 archives | pending |
| `ingress-smoke.mjs` | not run (Docker); last evidence `v0.10.0-rc.3`, nothing in ingress moved since | not in the matrix |
| `failure-smoke.mjs` (incl. settings propagation) | not run (Docker) | not in the matrix |
| Production preset cold start on Node 24 | median 532 ms wall to the banner, `ready in` 339 ms, five runs, [recorded](../design/0.11-measurements.md) | the matrix does not measure it |

Source under release: `342bba4`, `fa1925c`, `3e08208`, `002f15e`, `da52b5e`
(S09, rc.2), `6b130fd` (S10 design), `96f64d3`, `7120d25` (S10), and the
versions commit that adds this file. PR #30 (the rc.2 post-publication
record, docs only) is open separately.

## Steps left for the release owner

1. Review and merge PR #30 (docs), then the release PR; let the matrix run
   with services and fill the CI column from its jobs.
2. With Docker running: `node scripts/ingress-smoke.mjs` and
   `node scripts/failure-smoke.mjs` against the packed 0.11.0 archives, and
   record both in `docs/design/`. The plan's cross-replica revocation case
   is not in `failure-smoke.mjs`; the auth cache lives in the shared Redis
   and every revocation path deletes the entry (security model, S08b), so
   the case is a verification of that design, not a gap in it.
3. Tag `v0.11.0` on the merge commit; the publish workflow verifies and
   uploads with `latest`.
4. Post-publication: digests against the run's manifest, dist-tags, the
   `--registry` smokes, and `npm install -g @tulipes/cli` followed by
   `tulipes update` on a candidate app in a sandbox.
