# Release — core 0.10.0-rc.2, spec 0.3.0-rc.5, mongoose 0.1.0-rc.2, bullmq 0.1.0-rc.1 and socket.io 0.1.0-rc.1

Status: complete — published and registry-verified on 2026-09-12. Authorized by
the user on 2026-09-12. Owning item: Sprint 04 closeout, under
[the existing release procedure](../releasing.md). Ships the queues and sockets
extractions accepted in [PR #8](https://github.com/kemora13conf/bp-backend-express/pull/8)
(`199dc39`) and [PR #9](https://github.com/kemora13conf/bp-backend-express/pull/9) (`26c374d`).

## Scope and acceptance

- Core `0.10.0-rc.2` (breaking for apps with queues or sockets), first
  `@tulipes/bullmq` `0.1.0-rc.1` and `@tulipes/socket.io` `0.1.0-rc.1` (peer core
  `^0.10.0-rc.2`), plus `@tulipes/spec` `0.3.0-rc.5` and `@tulipes/mongoose`
  `0.1.0-rc.2` with no source change: `yarn pack` rewrites their `workspace:*`
  devDependency on core to the concrete version, so their archives cannot be
  byte-identical to the rc.1 ones (verified locally: only that manifest line
  differed). npm dist-tag `next` for all five.
- Generated production apps depend on all three providers; the minimal starter
  on core and spec only. Changelog, migration guide (anchors
  `0100-rc2--declare-the-{queues,sockets}-provider`, `unreleased--…` preserved),
  support policy and provider READMEs updated.
- Full CI (nine jobs) on the release PR before merging; tag `v0.10.0-rc.2`; the
  gated workflow verifies five archives — core free of every extracted driver —
  and publishes; registry digests, dist-tags and `--registry` smokes for both
  presets afterwards. First publishes receive `latest` from npm (see rc.1).

Not part of this candidate: CLI/tooling split (S12), translation contract (S13),
feature composition (S14), production pilot, stable claims.

## Evidence and progress

- Source under release: master `26c374d`; PR #8 and PR #9 each passed all eight
  verification jobs.
- Found during release validation: the packed production smoke's script-mode
  `promote` step crashed on an unhandled BullMQ "error" event (a reply lost
  while QUIT cut a still-initializing producer short). Fixed in this release
  branch — `@tulipes/bullmq` observes driver errors and finishes queue
  initialization before closing — with a regression test; the smoke then
  passed twice in a row.
- Registry preflight: `next` was core `0.10.0-rc.1` / spec `0.3.0-rc.4` /
  mongoose `0.1.0-rc.1`; bullmq and socket.io absent.
- Local validation of the release tree (macOS arm64, Node 24.14.0, Yarn 4.18.0):
  257 tests with services, typechecks, immutable install, five archives verified,
  packed minimal/offline/upgrade smokes, packed production runtime three times
  after the bullmq fix.
- [PR #10](https://github.com/kemora13conf/bp-backend-express/pull/10): the
  pull-request CI run on head `65ce394` passed all eight jobs; the parallel push
  run's `upgrade` job failed on a Yarn-internal transient ("The `onCancel`
  handler was attached after the promise settled" during `yarn install`),
  unrelated to the change. Merged as `0cef22e`; annotated tag `v0.10.0-rc.2`.
  Merge and tag should have waited for an explicit all-green gate rather than a
  printed check list — the gate that actually protected publication was the
  tag workflow's own verification.
- [Tag publication workflow](https://github.com/kemora13conf/bp-backend-express/actions/runs/34695882944)
  passed all ten jobs, including `upgrade`, and published the five verified
  archives without repacking; its `release-packages` artifact is retained in
  ignored `reports/rc2-release-artifacts/`.
- Registry verification at `2026-09-12T13:24:52.675Z`: for each of the five packages
  the version metadata integrity and the downloaded tarball digest equal the tag
  workflow's manifest, and `next` selects the new version. `latest` remains core
  `0.8.0` / spec `0.2.0` / mongoose `0.1.0-rc.1`; the two first publishes carry
  `latest = 0.1.0-rc.1` (npm behavior, as recorded for rc.1). Raw results:
  `reports/rc2-registry-verification.json`.
- Clean registry installation (`scaffold-smoke.mjs --registry`) on Node 24.14.0 /
  macOS arm64: minimal with the absence probe (no driver resolvable), production
  offline with connections denied, production runtime with dedicated local
  services (backend, worker, login, PM2). Logs: `reports/scaffold-*-registry/`.

## Published archive identity

Source: `0cef22e`, tag `v0.10.0-rc.2`.

| Package | Registry archive bytes | SHA-512 integrity |
|---|---:|---|
| `@tulipes/core@0.10.0-rc.2` | 350663 | `sha512-xen8UbOw1rGAe6+GevrHSKtJAEVdV63ZEQKlo00jcsXyKyY4JxzsC60ts/zDpw3v8FLhcifBe5gk/m8Rid8W5g==` |
| `@tulipes/spec@0.3.0-rc.5` | 15369 | `sha512-wRihY6yc/suBdijLVqVnwxeHhA0DRtRlB/G1eT27MWAWa1NWJ7E/ysXne3pZFzYWHCUvhBHjDSInCy6NFyn4+w==` |
| `@tulipes/mongoose@0.1.0-rc.2` | 7409 | `sha512-XBv9A3WcVhgduLzGwuB/GnikJRikypkpGAgWj/XFY0hboRDKtBhF8O6IfN91yXX4xMEATqrKCgM1GXisDoyfqQ==` |
| `@tulipes/bullmq@0.1.0-rc.1` | 9389 | `sha512-Ae07P3JagEjAP9ESbKgWK62wkbSOhixD/MAsS3P3KqixmYHR/taUgTmtour3OTkssQwAhc1I+AVT7rB0KGtPFQ==` |
| `@tulipes/socket.io@0.1.0-rc.1` | 6670 | `sha512-JzkN0S2Vcqqq/fXLH87q+TF3h2nUG47y1S20uHyZd4i+Mbzfq3Vj7hHGqUqts7VuY1urFYwUAaqTBsGToP4Wkw==` |
