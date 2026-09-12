# Release — core 0.9.0-rc.3 and spec 0.3.0-rc.3

Status: complete — published and registry-verified on 2026-09-11. Authorized by the user on 2026-09-11.
Owning item: 01-C4, candidate release preparation/publication under
[the existing release procedure](../releasing.md). This is a bounded release of
accepted Sprint 02 behavior; Sprint 03 implementation remains unstarted.

## Scope and acceptance

- Core `0.9.0-rc.3`, spec `0.3.0-rc.3`, npm dist-tag `next` for both.
- Native-router offline inspection, migrated starters, S08a–S08m security/lifecycle
  corrections and the matching spec extraction context.
- Update generated ranges, the spec/core peer contract, changelog, migration and
  support documentation. Preserve migration anchor compatibility.
- Review the release PR and pass the existing full CI workflow before merging.
- Tag the merged source as `v0.9.0-rc.3`; publish only exact archives built and
  verified by the gated tag workflow. Do not move old tags or overwrite versions.
- Verify registry versions, dist-tags and SHA-512 digests against those archives;
  perform a clean registry installation and generated app smoke.

Provider extraction, cookie authentication, stable/1.0 claims, deployment and
repository visibility changes are not part of this candidate. The user authorized
publication; necessary branch/PR/merge/tag operations follow the release procedure.

## Evidence and progress

- Prior Sprint 02 source `37dbca7` passed all seven CI jobs; see the
  [Sprint 02 evidence map](production-readiness-02-evidence.md). New versioned archive
  bytes require fresh verification and do not inherit publication approval from
  those older digests.
- Registry preflight on 2026-09-11: `next` was core `0.9.0-rc.2` / spec
  `0.3.0-rc.2`; `latest` was core `0.8.0` / spec `0.2.0`. Neither rc.3 version
  existed. GitHub default branch is `master`; the repository remains private.
- Existing `NPM_TOKEN` repository secret is configured. The gated workflow selects
  the token path; no credential values are read or copied. npm's current
  [authentication](https://docs.npmjs.com/trusted-publishers/) and
  [provenance](https://docs.npmjs.com/generating-provenance-statements/) requirements
  were checked; no account or visibility setting is changed.
- Local versioned validation passed on macOS arm64, Node `24.14.0`, Yarn
  `4.18.0`: immutable install; 225 core/spec tests in 23 files with required
  integration services; 55 reference-app tests; package/test/reference type checks;
  generated/reference parity and both generated rc.3 dependency ranges. Coverage
  was statements 82.01%, branches 68.70%, functions 86.74%, lines 84.14%.
- Local packed minimal and production installs passed generated types/tests/specs,
  HTTP boot/shutdown and production worker/PM2 checks. Production offline specs
  passed determinism checks with connections denied and runtime secrets absent.
  Dedicated temporary MongoDB/Redis processes were disposed by the harness.
- Local workspace and installed-starter dependency audits reported no high/critical
  findings; the retained moderate cron-parser maintenance advisory remains visible.
- Local documentation checks validated 37 links and preserved all 14 migration
  anchors. Raw evidence: ignored `reports/rc3-*.log` and
  `reports/rc3-workspace-runtime.jsonl`.
- These local archives were built from the uncommitted version-preparation tree
  over `7b8a251`; their manifest SHA is the parent, not a release source identity.
  They are local validation only and will not be uploaded. Branch CI and the gated
  tag workflow must build/verify archives from their exact committed sources.
- Release preparation commit: `06a3f48594861a8411c3a3decedbdd7874b86952`.
  [PR #4](https://github.com/kemora13conf/bp-backend-express/pull/4) received
  independent Standards and Spec source reviews against `041d169...06a3f48`;
  both reported zero findings, recorded as a PR review. These were agent source
  reviews, not an additional human approval or independent test rerun.
- Both [branch CI](https://github.com/kemora13conf/bp-backend-express/actions/runs/34638699176)
  and [PR CI](https://github.com/kemora13conf/bp-backend-express/actions/runs/34638709792)
  passed all seven jobs: tests/types/coverage on Node 24.0.0 and current 24,
  packing/parity/audit, minimal on Ubuntu/macOS, production offline and production
  runtime/worker/PM2. Raw run metadata: `reports/rc3-branch-ci.json` and
  `reports/rc3-pr-ci.json`.
- PR #4 merged as `9d2a50cfef39b63f364f77ca6e6918a2f931dd6c`; its tree matches
  the reviewed `06a3f48` tree. Annotated tag `v0.9.0-rc.3` points to that merged
  source. The [tag publication workflow](https://github.com/kemora13conf/bp-backend-express/actions/runs/34639537725)
  passed all nine jobs, including release-tag validation, the seven verification
  jobs and publication. It published the verified archives without repacking.
  Raw metadata/logs: `reports/rc3-publication-{run,jobs}.json` and
  `reports/rc3-publication.log`.
- Registry digest verification passed at `2026-09-11T19:40:57Z`. Both version
  metadata SHA-512 values and downloaded tarball bytes exactly match the tag
  workflow's archives, retained in `reports/rc3-release-artifacts/`. Both `next`
  tags select rc.3; `latest` remains core `0.8.0` / spec `0.2.0`. npm reported a
  brief processing delay after accepting publication; verification waited for
  both versions. Raw results: `reports/rc3-registry-verification.json`.
- Clean registry installation and generated smoke passed locally on Node
  `24.14.0` / macOS arm64: minimal sync/types/tests/specs/HTTP boot/shutdown;
  production offline determinism with connections denied; production
  sync/types/tests/specs, backend/shutdown, worker and PM2 restart. Fresh CLI and
  generated-app roots installed from the registry outside the monorepo, asserted
  both installed rc.3 versions, and used no local archive resolutions. Installed
  dependency audits passed with no high/critical findings. Dedicated test services
  and temporary app directories were cleaned up. Logs: `reports/rc3-registry-*`.
- Yarn 4.18.0's
  default one-day package age gate rejected the new versions initially. The
  disposable fixture preapproves only `@tulipes/core@0.9.0-rc.3` and
  `@tulipes/spec@0.3.0-rc.3`, after their archive bytes were verified, using
  [Yarn's package-specific setting](https://yarnpkg.com/configuration/yarnrc#npmPreapprovedPackages).
  No global/repository setting or generated dependency range was changed. The
  original quarantine output is retained in `reports/rc3-registry-age-gate-repro/`.

## Published archive identity

Source: `9d2a50cfef39b63f364f77ca6e6918a2f931dd6c`, tag `v0.9.0-rc.3`.

| Package | Registry archive bytes | SHA-512 integrity |
|---|---:|---|
| `@tulipes/core@0.9.0-rc.3` | 347073 | `sha512-CtXi16WbcSc4zjQ3KC9IETN+0ouj8hEmaXGXiRVNF14szCjqHDTUS6sg26nUv59xzl41u/j/Oew0po/TOlLBYA==` |
| `@tulipes/spec@0.3.0-rc.3` | 14883 | `sha512-x1zX7zr6iL/h95yagQdBY8LxQB16ZdkSu/Klf+0Hp5d8lqfKrmolpLZEWkAPIYojb1EzUdCicP4Yeb8MC4Ddzw==` |

## Follow-up backlog

- [x] **01-C4-registry-smoke** (closed by the 0.10.0-rc.1 release: `scaffold-smoke.mjs --registry`): retain a reusable registry smoke command with
  exact-version fixture preapproval for newly published, digest-verified packages.
  Document Yarn's release-age gate for immediate candidate installs. Current
  release verification uses ignored `reports/rc3-registry-*.{mjs,py}`; reusable
  tooling/documentation changes belong to a separate change set and do not block
  this completed release.


Retain raw local/release output in ignored `reports/rc3-*` and add exact workflow,
PR, source and digest evidence here as each gate completes. Do not mark publication
complete until both registry packages and the installed smoke are verified.
