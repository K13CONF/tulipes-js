# Release — core 0.10.0-rc.3 with the first @tulipes/cli 0.1.0-rc.1

Status: complete — published and registry-verified on 2026-09-12. Authorized by
the user on 2026-09-12. Owning item: Sprint 05 closeout, under
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
- [PR #15](https://github.com/kemora13conf/bp-backend-express/pull/15) passed all
  nine verification jobs (including `composition`) and merged as `40160ac`;
  annotated tag `v0.10.0-rc.3` points to that merge.
- [Tag publication workflow](https://github.com/kemora13conf/bp-backend-express/actions/runs/34699943272)
  passed all eleven jobs and published the six verified archives without
  repacking; its `release-packages` artifact is retained in ignored
  `reports/rc3b-release-artifacts/`.
- Registry verification at `2026-09-12T14:50:21.500Z`: for each of the six packages the
  version metadata integrity and the downloaded tarball digest equal the tag
  workflow's manifest, and `next` selects the new version. `latest` remains core
  `0.8.0` / spec `0.2.0` / providers `0.1.0-rc.1`; `@tulipes/cli`'s first publish
  carries `latest = 0.1.0-rc.1` (npm behavior, as for the other first publishes).
  Raw results: `reports/rc3b-registry-verification.json`.
- Clean registry installation (`scaffold-smoke.mjs --registry`) on Node 24.14.0 /
  macOS arm64: minimal with the absence probe (no driver, no `tsx` and no CLI
  resolvable from core), production offline with connections denied, and the
  production runtime with dedicated local services (backend, worker, login,
  PM2). The launcher installed `@tulipes/cli` alone, as a global install does.
  Logs: `reports/scaffold-*-registry/`.

## Published archive identity

Source: `40160ac`, tag `v0.10.0-rc.3`.

| Package | Registry archive bytes | SHA-512 integrity |
|---|---:|---|
| `@tulipes/core@0.10.0-rc.3` | 203730 | `sha512-jfAyICoh3jua4ourB81u/guEArNKxMZQg6viTsYrfnpC8SZ9sERglsNHoW1Qo6Mr+6GsBzA5jjLuG15R6/XcDQ==` |
| `@tulipes/spec@0.3.0-rc.6` | 15369 | `sha512-xo6R4dBrrvAb5Is5pos6lXGj+VG+Re9eG8hUQ9K15l1NqDJnVBHG37fyRVJXGo5k7HEN0NUWyUUrJP7kdzS5EQ==` |
| `@tulipes/mongoose@0.1.0-rc.3` | 7410 | `sha512-4J/xdzORhpFOTGfHGsyFEwOsVdR3owWfIHydwyrakiG1Z5yjYB3R6qtBcv1n4prpxX2OKf3NJzkqN53t8kp/+g==` |
| `@tulipes/bullmq@0.1.0-rc.2` | 9682 | `sha512-qS8N6015gHKIRH5AjmKNL3gHLOBqMUZ0rLwgerS4LFGTmWp0tSmrZ06RIlyZLQHUXX6dCJo3vC4OQy6co5vNvg==` |
| `@tulipes/socket.io@0.1.0-rc.2` | 6674 | `sha512-qW89sus0lI34wrAi89L8VyrOZrBm5Jy9sSRWcxV605QErVwxqb57BbdTpeO2NWpEYrgGzNxL7Hm13mklR/S2xw==` |
| `@tulipes/cli@0.1.0-rc.1` | 152782 | `sha512-yFGE6Qh15UklU2MLV5Fvkk1034RxR85UzqhTVFMX5Cxs5tkIo+DNk+U9g+aFvwNvPfX8MVuBh5roN1f78t3fCg==` |
