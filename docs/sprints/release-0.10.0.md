# Release — 0.10.0, the first stable line

Status: complete — published to `latest` and registry-verified on 2026-09-12.
Authorized by the user on 2026-09-12. Owning item: the release decision the user took on 2026-09-12
after the Sprint 06 status was presented. Procedure:
[releasing.md](../releasing.md).

## What is being released

| Package | Version | dist-tag |
|---|---|---|
| `@tulipes/core` | 0.10.0 | `latest` |
| `@tulipes/cli` | 0.1.0 | `latest` |
| `@tulipes/spec` | 0.3.0 | `latest` |
| `@tulipes/mongoose` | 0.1.0 | `latest` |
| `@tulipes/bullmq` | 0.1.0 | `latest` |
| `@tulipes/socket.io` | 0.1.0 | `latest` |

Each provider's peer range narrows to `^0.10.0` — a stable provider requires a
stable core, and a caret on a stable version does not admit prereleases. Spec
keeps `^0.9.0-rc.3 || ^0.10.0` so an app still on the 0.9 candidate is not
stranded. Generated apps get `^0.10.0`, `^0.1.0` and `^0.3.0` ranges.

## What "stable" claims, and what it does not

Claims: the 0.10 API is settled and breaking changes wait for 0.11; the
supported journeys — both presets, every provider combination, offline
inspection, packed installs, the upgrade path from 0.9.0-rc.3 — run in CI on
every commit; core installs 7.6 MB where 0.9 installed 53 MB.

Does not claim production-proven. No pilot deployment has run this framework.
There is no load evidence, no backup/restore rehearsal, no multi-replica
behaviour and no independent security review; Sprint 06 records exactly what is
missing and why it cannot be produced from this repository alone. The support
policy states this in the same words a user will read before choosing it.

The last three operational fixes — a replica-set `MONGO_URI` that could not
boot, a boot failure masked by Socket.IO cleanup, and a Redis outage that
answered 500 on every endpoint — landed in
[PR #18](https://github.com/kemora13conf/bp-backend-express/pull/18) hours
before this release, which is itself a fact about maturity worth recording.

## Gates

- Full CI (ten jobs) on the release PR before merging.
- Tag `v0.10.0`; the gated workflow verifies six archives — the CLI carries the
  binary and templates, core carries neither nor any extracted driver — and
  publishes each to `latest` (the tag is chosen by the absence of a prerelease
  suffix, so no workflow change is needed).
- After publication: registry digests and dist-tags for all six, then
  `scaffold-smoke.mjs --registry` for both presets.

## Evidence

- Source under release: master `8701c8e`.
- Registry preflight on 2026-09-12: `latest` was core 0.8.0 / spec 0.2.0 /
  providers 0.1.0-rc.1 / cli 0.1.0-rc.1; `next` was core 0.10.0-rc.3, spec
  0.3.0-rc.6, mongoose 0.1.0-rc.3, bullmq and socket.io 0.1.0-rc.2, cli
  0.1.0-rc.1. None of the stable versions existed.
- Local validation (macOS arm64, Node 24.14.0, Yarn 4.18.0): immutable install;
  267 tests in 28 files with required services; package, test and reference
  typechecks; `sync`; six archives packed and verified; packed minimal,
  production offline, `--no-queues --no-sockets` offline, upgrade from the
  published 0.9.0-rc.3 starter, and the packed production runtime with worker
  and PM2.
- [PR #19](https://github.com/kemora13conf/bp-backend-express/pull/19) passed all
  nine verification jobs and merged as `6a57f13`; annotated tag `v0.10.0` points
  to that merge.
- [Tag publication workflow](https://github.com/kemora13conf/bp-backend-express/actions/runs/34706780935)
  passed all twelve jobs and published the six verified archives without
  repacking; the `release-packages` artifact is retained in ignored
  `reports/stable-release-artifacts/`.
- Registry verification at `2026-09-12T17:04:13.573Z`: for all six packages the version
  metadata integrity and the downloaded tarball digest equal the tag workflow's
  manifest, and **`latest` now selects the stable version** of each. The `next`
  tags still point at the candidates they always did.
  Raw results: `reports/stable-registry-verification.json`.
- Clean registry installation (`scaffold-smoke.mjs --registry`) on Node 24.14.0 /
  macOS arm64: minimal with the absence probe, production offline with
  connections denied, and the production runtime with dedicated services
  (backend, worker, login, PM2). Nothing resolved from a local archive.

## Published archive identity

Source: `6a57f13`, tag `v0.10.0`.

| Package | Registry archive bytes | SHA-512 integrity |
|---|---:|---|
| `@tulipes/core@0.10.0` | 205235 | `sha512-sngj4rxHNNxMv74g/F/zBtHRmJJg7aoymt1zZNMr9Als3QSM7zMISioFab+RlefEx7vQdSVtHJK4ln8Ak+0b5g==` |
| `@tulipes/spec@0.3.0` | 15360 | `sha512-nbK9YPtBdizeNvZYA8U0SPzCmXnkEIkOtWbplZjG+3hQudBBIiFvx7OHZDr0jPlc+zxOaIbgU67/SRF/u1DhFA==` |
| `@tulipes/mongoose@0.1.0` | 7405 | `sha512-YbVJye5I16EP4QFjA3kFjrFQTfdkD3PPvfV3VhVhltYBjKAGzdxmdHSx7ogVKTAGKW+uhHDiDv8LebhAn2SLyQ==` |
| `@tulipes/bullmq@0.1.0` | 9675 | `sha512-kcboHIvdz3lsjWvkNPk5cmksbF+AEnhFxrTVZtc+Q4omZxduVnj70GxeWqd84e9CyTRdYGTiHx/ifmQQDpCbBg==` |
| `@tulipes/socket.io@0.1.0` | 6882 | `sha512-1Vkr5ywRRqhbP/7NDP4Xuc1iGFlnPGQO5j13gsgImar4tojUEtgtiKSl8dJzPYY0CB+Ki7hzWVTiKYDl+4CtzA==` |
| `@tulipes/cli@0.1.0` | 153454 | `sha512-fh7pgJdo1XVRhvB+KV2S23K42ST6DKE2BgcW/WKaYCdi4ah/JIggZpGfZoqFkneUEv8K2Mlzw3gZlXnOeteFTg==` |

## What remains true after publication

Publication is not evidence of readiness, and this release does not claim it.
The next milestone is a production pilot: until one runs, Sprint 06's blocked
tasks stay blocked and 1.0 stays unclaimed.
