# Release — 0.10.0, the first stable line

Status: prepared on 2026-09-12; tag and publication pending the release owner's
authorization. Owning item: the release decision the user took on 2026-09-12
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
- Release PR, CI, tag workflow, registry verification and registry smokes: to
  record as each gate completes.

## Published archive identity

To record from the tag workflow's manifest after publication.
