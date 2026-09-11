# Release — core 0.9.0-rc.3 and spec 0.3.0-rc.3

Status: preparation in progress. Authorized by the user on 2026-09-11.
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
- Release PR/review and branch CI: pending.
- Merged source/tag and publication workflow: pending.
- Registry digest/install verification: pending.

Retain raw local/release output in ignored `reports/rc3-*` and add exact workflow,
PR, source and digest evidence here as each gate completes. Do not mark publication
complete until both registry packages and the installed smoke are verified.
