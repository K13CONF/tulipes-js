# Releasing

The release owner is `@kemora13conf`. Repository visibility remains private.
No release is created just by merging a feature PR.

1. Update versions of every changed published package, changelog, migration notes
   and supported lines. Update generated dependency ranges and spec's core peer
   range when necessary. Three packages are packed and published together —
   `@tulipes/core`, `@tulipes/spec` and `@tulipes/mongoose`; every one whose
   bytes changed needs a new version before publication, and the provider's
   core peer range must admit the core it ships with.
2. Open and merge a reviewed PR with passing CI. For structural changes, choose
   a prerelease version first (for example `0.9.0-rc.1`) and compatible spec
   dependencies. RC versions publish to `next`, stable versions to `latest`.
3. Create and push `v<core-version>` from that merged commit. Manual workflow
   dispatch must also select a matching tag reachable from the default branch.
4. The reusable verification workflow runs unit/integration tests on minimum and
   current Node 24, type checks, coverage floors and scaffold parity. It packs
   each package once and records the source commit and SHA-512 digest.
5. Separate jobs install those archives in temporary projects and exercise the
   compiled CLI, both presets, generated types, tests, specs, HTTP boot/shutdown
   and production worker/PM2 restart. Minimal runs on Ubuntu and macOS without
   services. Production uses isolated MongoDB and Redis services. Dependency
   audits include the starters' development/deployment tools and block high or
   critical findings. Reports and coverage are retained as workflow artifacts.
6. Publication downloads those same archives, verifies their digests, identity,
   required files and commit, and rechecks tag ancestry. Registry failures block
   publication. Every existing package version is checked before the first
   upload; only an identical existing archive may be skipped.

## Authentication

The existing `NPM_TOKEN` repository secret remains supported. For tokenless
publishing, configure a trusted publisher for **each** npm package using this
GitHub owner/repository and `publish.yml`, then set repository variable
`NPM_TRUSTED_PUBLISHING=true`. The publish job grants `id-token: write` and uses
npm 11 on Node 24. npm-side trust configuration is a maintainer account action;
adding this workflow does not configure npm automatically.

Provenance remains disabled for this private repository because npm requires
public source for provenance. Tokenless authentication and provenance are
separate capabilities. [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/),
[provenance prerequisites](https://docs.npmjs.com/generating-provenance-statements/).

## Recovery

Never move an existing release tag or overwrite a published version. If a gate
fails, fix the cause in a new PR and version as needed. If publication partially
succeeds, recover using the original verified archives: an identical published
package is skipped, and any byte mismatch stops the run. Repacking on a rerun
can change bytes; when the original archive cannot be recovered, release new
versions. npm has no transaction spanning the packages.

Do not bypass failed audits, digest checks or smoke tests to meet a release date.
Review moderate/low findings in retained reports; no high/critical exceptions
are currently configured.
