# Release — core 0.11.0-rc.2, the `tulipes update` fix

Status: **published** on 2026-10-08 from `b72584a` (merge of #29), tag `v0.11.0-rc.2`, publish run [37704532712](https://github.com/kemora13conf/bp-backend-express/actions/runs/37704532712). Owning items: 0.11-S09.1 to S09.3 in
[the 0.11 plan](./0.11-plan.md). Publication follows
[the release procedure](../releasing.md): a reviewed PR with green CI, then
the `v0.11.0-rc.2` tag on its merge commit.

## Scope and acceptance

- The reason for the candidate: the rc.1 CLI's `tulipes update` downgrades a
  candidate app to `^0.10.1` and the global CLI to 0.1.1, because it follows
  npm's `latest` tag without comparing versions. rc.2 raises only, leaves
  `workspace:`, `file:` and compound ranges alone, and moves every declared
  `@tulipes` package to the version paired with the new core.
- The agent surface and `@tulipes/mcp` are documented as experimental. No
  runtime code in core, the providers, spec, testing or mcp changed.
- Versions: core `0.11.0-rc.2`, `@tulipes/cli` `0.2.0-rc.2`, `@tulipes/spec`
  `0.3.2-rc.2`, `@tulipes/mongoose` and `@tulipes/bullmq` `0.2.0-rc.2`,
  `@tulipes/socket.io` `0.1.2-rc.2`, `@tulipes/mcp` and `@tulipes/testing`
  `0.1.0-rc.2`. All eight are republished because packing rewrites each
  core dependency. The peer ranges (`^0.11.0-rc.1`, `^0.3.2-rc.1`) already
  admit rc.2 and are unchanged; the minimal template is on workspace ranges,
  so the generator pins the new versions. npm dist-tag `next`.
- Migration from rc.1: none in the app; `MIGRATING.md` says to install the
  rc.2 CLI before running `tulipes update`.

## Evidence

CI is [run 37703391466](https://github.com/kemora13conf/bp-backend-express/actions/runs/37703391466) on PR [#29](https://github.com/kemora13conf/bp-backend-express/pull/29), head `002f15e`; the push-triggered run on the same head (37703338330) passed identically. Local runs are on macOS (Darwin 25.2), Node 24.14.0, pnpm 10.28.0, on
2026-10-08, without MongoDB, Redis or Docker.

| Check | Local | CI |
|---|---|---|
| `pnpm install --frozen-lockfile` | pass | pass on every job |
| `pnpm typecheck`, `pnpm test:types` | pass | pass on both tests jobs ([tests 24](https://github.com/kemora13conf/bp-backend-express/actions/runs/37703391466/job/113071921623)) |
| `pnpm test` | 234 passed, 40 skipped (integration suites, no services); one run before it had a timing failure in the file settings store's watcher test, which passes alone (plan S09 backlog) | 276 passed, 0 skipped, 33 files, with services, on [tests 24](https://github.com/kemora13conf/bp-backend-express/actions/runs/37703391466/job/113071921623) and [24.0.0](https://github.com/kemora13conf/bp-backend-express/actions/runs/37703391466/job/113071921857) |
| `vitest run packages/cli` | 36 passed; `update.ts` 94.6 % statements | inside `pnpm test` above |
| `scripts/artifacts.mjs prepare` + `verify` | eight archives verified | pass ([pack](https://github.com/kemora13conf/bp-backend-express/actions/runs/37703391466/job/113072531340)) |
| `scaffold-smoke.mjs minimal` | pass, 11.9 s (packed install, generated types, tests, specs, backend/shutdown) | pass on [Ubuntu](https://github.com/kemora13conf/bp-backend-express/actions/runs/37703391466/job/113072701156) and [macOS](https://github.com/kemora13conf/bp-backend-express/actions/runs/37703391466/job/113072701135) |
| `scaffold-smoke.mjs production --offline-only`, `--no-queues --no-sockets --offline-only` | pass, both (network connections denied) | pass ([offline](https://github.com/kemora13conf/bp-backend-express/actions/runs/37703391466/job/113072701084), [composition](https://github.com/kemora13conf/bp-backend-express/actions/runs/37703391466/job/113072701271)) |
| `scaffold-smoke.mjs production` (online) | not run (services) | pass, 1 m 56 s ([production](https://github.com/kemora13conf/bp-backend-express/actions/runs/37703391466/job/113072701086)) |
| `upgrade-smoke.mjs` (0.10 app → `migrate 0.11` + `config:import`) | pass from cli 0.1.1 / core 0.10.1 onto the eight rc.2 archives | pass ([upgrade](https://github.com/kemora13conf/bp-backend-express/actions/runs/37703391466/job/113072701075)) |
| `ingress-smoke.mjs`, `failure-smoke.mjs` | not run (Docker) | not part of the matrix |

Source under release: `342bba4` (S09.1), `fa1925c` (S09.2), `3e08208`
(S09.3), and the versions commit that adds this file.

## Steps left

1. ~~Open the PR; fill the CI column from its run.~~ Done: #29, whole matrix green.
2. ~~Merge after review with green CI.~~ Done: `b72584a`, after the run on
   `da52b5e` (the CI column commit) was green too.
3. ~~Tag `v0.11.0-rc.2` on the merge commit.~~ Done; the publish run's
   `validate-release`, the whole verification matrix and `publish` passed,
   and its log shows all eight uploads with `--tag next`.
4. ~~Post-publication checks.~~ Below.

## Post-publication checks (2026-10-08, macOS, Node 24.14.0)

- **Visibility.** The registry answered 404 for four of the eight versions
  for about two minutes after the run finished, then served all eight;
  nothing was republished.
- **Digests.** The run's `release-packages` artifact downloads and
  `scripts/artifacts.mjs verify` accepts it against `b72584a` (identity,
  contents, digests); every package's registry `dist.integrity` equals the
  manifest's.
- **Dist-tags.** `next` is rc.2 on all eight. `latest` is unchanged: core
  0.10.1, cli 0.1.1, spec 0.3.1, the providers 0.1.1, and `@tulipes/mcp`
  and `@tulipes/testing` still `0.1.0-rc.1` from their first publish, so an
  untagged install of either gets rc.1. Moving `latest` is the owner's call.
- **Registry smokes** (`--registry`): minimal passed in 12.1 s; production
  `--offline-only` and `--no-queues --no-sockets --offline-only` passed with
  network connections denied. The online production variant was not run
  here (services); the publish run's `production` job covered the archives.
- **The fix, from npm.** `@tulipes/cli@0.2.0-rc.2`, installed into a scratch
  prefix and run with stub `npm`/`pnpm` on `PATH`, against a candidate app
  (`^0.11.0-rc.2` core and mongoose, `^0.2.0-rc.2` cli) and the live
  registry (`latest` 0.10.1 / 0.1.1): "cli already on 0.2.0-rc.2 (latest is
  0.1.1)", manifests unchanged, no install started. One wording defect: with
  core not installed it reports "app already on @tulipes/core ^0.10.1" (the
  `latest` range) instead of the declared `^0.11.0-rc.2` (S09 backlog).
- **What went wrong on the way.** A first attempt ran `npx -y
  @tulipes/cli@0.2.0-rc.2 update`; npx ran the globally installed rc.1
  `tulipes` instead, whose `update` reproduced the bug for real: it
  downgraded the maintainer's global CLI (Node 24.14.0 prefix) to 0.1.1 and
  a scratch app to `^0.10.1`. The global was reinstalled at 0.2.0-rc.1 at
  once; the scratch app was discarded. It is also the clearest evidence of
  the rc.1 defect: never test `update` outside a sandbox.
