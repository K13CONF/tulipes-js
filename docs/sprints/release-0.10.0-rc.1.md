# Release — core 0.10.0-rc.1, spec 0.3.0-rc.4 and mongoose 0.1.0-rc.1

Status: complete — published and registry-verified on 2026-09-12. Authorized by
the user on 2026-09-12. Owning item: Sprint 03 closeout, under
[the existing release procedure](../releasing.md). This is the first
three-package candidate: it ships the provider extraction accepted in
[PR #5](https://github.com/kemora13conf/bp-backend-express/pull/5) (`21040d5`).

## Scope and acceptance

- Core `0.10.0-rc.1` (breaking: Mongoose extracted, provider seam), spec
  `0.3.0-rc.4` (README and peer range only; no source change), mongoose
  `0.1.0-rc.1` (first release). npm dist-tag `next` for all three.
- Generated production apps depend on `@tulipes/mongoose ^0.1.0-rc.1` and
  `@tulipes/spec ^0.3.0-rc.4`; the minimal starter depends on core and spec only.
- Provider peer ranges: `@tulipes/core ^0.10.0-rc.1`, `mongoose ^8`. Spec peer
  range `^0.9.0-rc.3 || ^0.10.0-rc.1` so an app still on rc.3 can take spec rc.4.
- Changelog, migration guide (anchor `0100-rc1--declare-the-models-provider`,
  with the `unreleased--…` anchor preserved), support policy and package READMEs
  updated; `docs/releasing.md` already describes the three-package inventory.
- Review and pass the full CI workflow (nine jobs: tests ×2, pack, minimal ×2,
  offline, upgrade, production, plus tag validation on publish) before merging.
- Tag the merged source `v0.10.0-rc.1`; publish only the archives built and
  verified by the gated tag workflow. `artifacts.mjs verify` refuses a core
  declaration importing mongoose and a provider bundling it.
- Verify registry versions, dist-tags and SHA-512 digests against those archives;
  perform a clean registry installation and generated app smoke for both presets
  (the `upgrade` job's registry fetch of `@tulipes/core@0.9.0-rc.3` remains the
  prior-contract fixture).

Not part of this candidate: queue/socket extraction (Sprint 04), cookie
authentication, stable/1.0 claims, deployment, repository visibility.

## Evidence and progress

- Source under release: PR #5 merged as `21040d5`; both PR CI runs passed all
  eight verification jobs on head `6249c59` (see
  [Sprint 03 §10](production-readiness-03.md#10-supported-ci-evidence)).
- Registry preflight on 2026-09-12: `next` is core `0.9.0-rc.3` / spec
  `0.3.0-rc.3`, `latest` core `0.8.0` / spec `0.2.0`; `@tulipes/mongoose` does not
  exist on the registry.
- Local validation of the version-preparation tree on macOS arm64, Node
  `24.14.0`, Yarn `4.18.0`: install with the refreshed lockfile; 244 core/spec/
  mongoose tests in 25 files with required integration services; test/package/
  reference typechecks and `sync`; three archives packed and verified (core
  declarations free of mongoose, provider with peers only); packed minimal smoke
  with the absence probe; production offline smoke with connections denied;
  upgrade smoke from the local rc.3 archive onto the three new archives; packed
  production runtime smoke (backend, worker, login, PM2). These local archives
  are validation only and are not uploaded.
- Release preparation commit `c27f143`; [PR #6](https://github.com/kemora13conf/bp-backend-express/pull/6)
  passed all eight verification jobs and merged as
  `b2b7846687215cad65040c778a33f47eba76f565`. Annotated tag `v0.10.0-rc.1` points
  to that merge. The [tag publication workflow](https://github.com/kemora13conf/bp-backend-express/actions/runs/34691032475)
  passed all ten jobs (release-tag validation, eight verification jobs including
  `upgrade`, publication) and published the verified archives without repacking.
  Its `release-packages` artifact is retained in ignored `reports/rc1-release-artifacts/`;
  its manifest commit is `b2b7846…`.
- Registry verification at `2026-09-12T11:36:52.353Z`: for each package the
  version metadata integrity and the downloaded tarball digest equal the tag
  workflow's manifest, and `next` selects the new version. Propagation took
  under a minute for core, about one minute for spec and about three minutes for
  the provider's dist-tags; verification waited. `latest` remains core `0.8.0` /
  spec `0.2.0`. **`@tulipes/mongoose` also carries `latest = 0.1.0-rc.1`**: npm
  assigns `latest` to a package's first publish regardless of `--tag`, and there
  is no stable version to move it to; the first stable provider release will
  take it over. Raw results: `reports/rc1-registry-verification.json`.
- Clean registry installation on Node `24.14.0` / macOS arm64 through the new
  reusable `scripts/scaffold-smoke.mjs … --registry` mode (closing backlog
  01-C4-registry-smoke): launcher and app installed from npm at exactly the
  published versions with generated ranges untouched and no `file:` archive;
  Yarn's release-age gate preapproved only the three verified versions.
  Minimal: sync, types, tests, offline specs, backend/shutdown, and the absence
  probe (`mongoose`, `mongodb`, `bson`, `@tulipes/mongoose` unresolvable from
  app, core and launcher). Production offline: deterministic specs with
  connections denied. Production runtime with dedicated local services: sync,
  types, tests, specs, backend/shutdown, worker, PM2; the provider resolved
  from the app, never through the launcher. Logs: `reports/scaffold-*-registry/`.

## Published archive identity

Source: `b2b7846687215cad65040c778a33f47eba76f565`, tag `v0.10.0-rc.1`.

| Package | Registry archive bytes | SHA-512 integrity |
|---|---:|---|
| `@tulipes/core@0.10.0-rc.1` | 352895 | `sha512-1HbM473R4IkWRnSz75VTF/yRasxuo4bFKfHKMgfQKGGr/LrcsznLnxXCW0X3hfo0LsHvTwei70VBEvZN3+P0Aw==` |
| `@tulipes/spec@0.3.0-rc.4` | 15312 | `sha512-ugxAPl9aI1skdPpPIlC7v6Pzbzc8t5I6wlWx9GvR/wIvml1S42hIKRCHVDrvYHQ5PQ2vtXaAIIk5uRiN4E6ZUw==` |
| `@tulipes/mongoose@0.1.0-rc.1` | 7380 | `sha512-tK1JJacvmmO3Q4eF4RLLBbZP+8M7vUkcuWIUm+JDpEyKk1zeJV+n2EmQtlv/r+n24fRZVx5E9cTeCbtWKssAbA==` |

## Follow-up backlog

- [x] **01-C4-registry-smoke:** `scaffold-smoke.mjs --registry` is the reusable
  command; it preapproves exactly the manifest's versions and refuses local
  archives.
- [ ] **release-first-publish-tag:** decide whether a first publish of a new
  package should be followed by an explicit `npm dist-tag` correction (not
  possible without a stable version) or simply documented, as here.
