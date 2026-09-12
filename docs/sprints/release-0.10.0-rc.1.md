# Release — core 0.10.0-rc.1, spec 0.3.0-rc.4 and mongoose 0.1.0-rc.1

Status: prepared on 2026-09-12; tag and publication pending the release owner's
authorization. Owning item: Sprint 03 closeout, under
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
- Release preparation commit, PR, branch/PR CI, tag workflow, registry digests,
  clean registry installation: to record as each gate completes.

## Published archive identity

To record from the tag workflow's manifest after publication.
