# Release — core 0.10.0-rc.2, spec 0.3.0-rc.5, mongoose 0.1.0-rc.2, bullmq 0.1.0-rc.1 and socket.io 0.1.0-rc.1

Status: prepared on 2026-09-12; tag and publication pending the release owner's
authorization. Owning item: Sprint 04 closeout, under
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
- Registry preflight, local validation, release PR, CI, tag workflow, registry
  verification and registry smokes: to record as each gate completes.

## Published archive identity

To record from the tag workflow's manifest after publication.
