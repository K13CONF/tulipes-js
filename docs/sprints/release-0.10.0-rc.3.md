# Release — core 0.10.0-rc.3 with the first @tulipes/cli 0.1.0-rc.1

Status: prepared on 2026-09-12; tag and publication pending the release owner's
authorization. Owning item: Sprint 05 closeout, under
[the existing release procedure](../releasing.md). Ships the CLI split
([PR #12](https://github.com/kemora13conf/bp-backend-express/pull/12)), the
translation decision ([PR #13](https://github.com/kemora13conf/bp-backend-express/pull/13))
and feature composition ([PR #14](https://github.com/kemora13conf/bp-backend-express/pull/14)).

## Scope and acceptance

- Core `0.10.0-rc.3` (breaking: no `tulipes` binary, no templates, no `tsx`),
  first `@tulipes/cli` `0.1.0-rc.1`, `@tulipes/spec` `0.3.0-rc.6`,
  `@tulipes/mongoose` `0.1.0-rc.3`, `@tulipes/bullmq` `0.1.0-rc.2` (connecting
  consumer fix) and `@tulipes/socket.io` `0.1.0-rc.2`. npm dist-tag `next`.
- Six archives. Spec, mongoose and socket.io carry no source change; they are
  republished because `yarn pack` rewrites their workspace core dependency to
  the concrete version (recorded in the release procedure).
- Migration: every app adds `@tulipes/cli` to `devDependencies`; a global
  `@tulipes/core` install is replaced by `npm i -g @tulipes/cli@next`.
- Generated production apps gain `--no-queues` / `--no-sockets` composition.
- Full CI (ten jobs, including `composition`) on the release PR before merging;
  tag `v0.10.0-rc.3`; the gated workflow verifies that the CLI archive carries
  the binary and templates and that core carries neither, nor any extracted
  driver, then publishes; registry digests, dist-tags and `--registry` smokes
  for both presets afterwards.

Not part of this candidate: production pilot, deployment and load evidence,
stable/1.0 claims, repository visibility.

## Evidence and progress

- Source under release: master `cb31fc6`; PRs #12, #13 and #14 each passed the
  full verification matrix.
- Registry preflight on 2026-09-12: `next` was core `0.10.0-rc.2`, spec
  `0.3.0-rc.5`, mongoose `0.1.0-rc.2`, bullmq `0.1.0-rc.1`, socket.io
  `0.1.0-rc.1`; `@tulipes/cli` did not exist.
- Local validation of the release tree (macOS arm64, Node 24.14.0, Yarn 4.18.0):
  immutable install; 265 tests in 27 files with required services; package,
  test and reference typechecks; `sync`; six archives packed and verified;
  packed minimal, production offline, `--no-queues --no-sockets` offline,
  upgrade from the published 0.9.0-rc.3 starter, and the packed production
  runtime (backend, worker, login, PM2).
- Release PR, CI, tag workflow, registry verification and registry smokes: to
  record as each gate completes.

## Published archive identity

To record from the tag workflow's manifest after publication.
