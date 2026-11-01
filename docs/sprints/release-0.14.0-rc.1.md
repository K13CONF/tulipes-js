# Release — core 0.14.0-rc.1

Status: **not started.** This is the checklist to finish before anything is
published. Branch `feat/client-headers`, 24 commits ahead of `master`, local only.

## Scope

- **Client headers** (C01–C04): `req.client` and the `X-Request-Id` round trip in
  both presets. App code, CLI templates.
- **R01, R02** ([`review-fixes-2026-11.md`](./review-fixes-2026-11.md)): docs
  agree on 0.13 and a public repository; **breaking:** a module grants only its
  own ids.
- **Security fixes SEC-01–SEC-16**
  ([`security-fixes-2026-11.md`](./security-fixes-2026-11.md)). **Breaking:**
  - `POST /auth/password` requires `current_password`;
  - `PATCH /config/:module` requires `version`;
  - a custom access checker refuses request-less `invoke()` (MCP, agent runs);
  - back-office deletes compare role `level`;
  - `settings.set()` resolves with `onChangeFailed` instead of throwing.

Why a candidate first: `docs/releasing.md` asks for one on structural changes,
and two HTTP endpoints change shape for clients.

## Before the PR

1. **Versions.** Core `0.14.0-rc.1`. Every package repacks with core, so all
   eight need new versions. Proposed:

   | Package | Now | Next | Why |
   |---|---|---|---|
   | `@tulipes/core` | 0.13.2 | 0.14.0-rc.1 | breaking (R02, checker, settings, env masking) |
   | `@tulipes/cli` | 0.4.2 | 0.5.0-rc.1 | templates change; `tulipes dev` sets APP_ENV; `update` |
   | `@tulipes/mcp` | 0.2.2 | 0.3.0-rc.1 | refuses `developmentIdentity()` on http; hides raw errors |
   | `@tulipes/socket.io` | 0.1.6 | 0.1.7-rc.1 | handler boundary, peer range |
   | `@tulipes/bullmq` | 0.3.0 | 0.3.1-rc.1 | workers parse job data |
   | `@tulipes/spec` | 0.4.3 | 0.4.4-rc.1 | repack, peer range |
   | `@tulipes/mongoose` | 0.2.4 | 0.2.5-rc.1 | repack, peer range |
   | `@tulipes/testing` | 0.1.4 | 0.1.5-rc.1 | repack, peer range |

2. **Core ranges.** spec, mongoose, bullmq, mcp and testing require
   `^0.13.0`, which does not admit 0.14. Change to `^0.13.0 || ^0.14.0-rc.1`
   (keep 0.13 only where the package still works on it, and test that) or to
   `^0.14.0-rc.1`. socket.io admits `^0.11.0 || ^0.12.0 || ^0.13.0`: add 0.14.
3. **`packages/cli/templates/versions.json`**: the new versions, so
   `tulipes init` scaffolds them.
4. **CHANGELOG** (`packages/core/CHANGELOG.md`): rename `[Unreleased]` to
   `[0.14.0-rc.1] — <date>`, add the package versions line, and add what is
   missing: client headers (both presets) and the R02 grant rule under one
   **Breaking** heading with the five security breaks above.
5. **MIGRATING**: rename the three "Unreleased" / unlabeled sections (security
   fixes, grants outside a module's own ids, client headers) to `0.14.0`, and put
   one ordered "upgrading from 0.13" summary on top that names the breaking
   steps first (R02, step 12, the checker and `level` rules).
6. **Decide `tulipes migrate 0.14`.** Earlier breaking lines shipped one. The
   mechanical parts here are few (adding `level` to roles, moving cross-module
   grants); MIGRATING by hand may be enough. Record the decision.
7. **Docs that name the current line:** root `README.md` ("0.13 is stable"),
   `docs/support.md` (current line, ranges, support table: 0.14 as candidate),
   `site/src/content/docs/production/changelog.mdx` (a 0.14 section),
   `site/.../start/installation.mdx` (the `tulipes update` sample output), and the
   core and mcp READMEs' "experimental in 0.13" lines.
8. **Regenerate** `example/docs/openapi.json` and `collection.json`
   (`pnpm spec` in `example/`) after the version bump.
9. **Local checks again**, recorded here: `pnpm install --frozen-lockfile`
   (the lockfile changes with the ranges: run `pnpm install` first, then the
   frozen install must pass), `pnpm typecheck`, `pnpm test:types`, root
   `pnpm test` and the example suite with both service variables, presets,
   site build and check, `node scripts/artifacts.mjs prepare` +
   `verify` (no new core dependency).
10. **Operational harnesses** (Docker, disposable services), not covered by the
    suites:
    - `scripts/upgrade-smoke.mjs`: a 0.13.2 app upgraded to the packed 0.14 —
      the path every existing user takes, now with breaking steps;
    - `scripts/scaffold-smoke.mjs` both presets from the packed archives;
    - `scripts/pm2-smoke.mjs` and `scripts/start-smoke.mjs`: the worker and
      the boot with `APP_ENV` set and unset (SEC-09 changed both);
    - `scripts/mcp-smoke.mjs`: MCP behavior changed (SEC-09, SEC-12).
11. **Review the diff** (`master..feat/client-headers`), or run
    `/code-review` on it. 24 commits touch auth, sessions, ACL and settings.

## PR, CI, tag

12. Push the branch and open the PR. The commits describe the vulnerabilities,
    so the push is the disclosure: do it when you are ready to release.
13. CI green on the PR: Node 24 minimum and current, coverage floors,
    scaffold parity (generated app vs `example/`), packed installs on Ubuntu and
    macOS, production preset with services, dependency audits (no high or
    critical).
14. Merge (reviewed), then tag `v0.14.0-rc.1` on the merged commit and push the
    tag. The publish job checks the tag matches core, the commit is on
    `master`, and the archive digests; prereleases go to `next`.

## After publication

15. Verify each package's registry integrity and tarball digest against the
    manifest, check dist-tags (`next` moved, `latest` still 0.13.2), and run
    `scaffold-smoke.mjs <artifacts> minimal --registry` and the production
    variant.
16. Write the Publication section of this file and update `docs/support.md`.
17. After the candidate has been used, release `0.14.0` from the same steps.

## Open questions

- **A 0.13.x patch for 0.13 users.** SEC-01 (anonymous Socket.IO crash) is
  in every app generated by the production preset. Most of the fix is app code
  (MIGRATING step 1), but `@tulipes/socket.io` 0.1.7 alone, with the handler
  boundary and its current core range, would protect 0.13 apps on
  `pnpm update`. Publication is tied to a tag that matches core's version, so
  a release that changes only socket.io needs a core 0.13.3 as well (and the
  0.13 branch it is cut from), or a change to that rule.
- **Advisories.** Whether to publish GitHub security advisories for SEC-01–08
  once the release is out.
- **Local test data.** The `bookstore` MongoDB database and Redis db 0 keys
  from the tutorial run are still on the local services; unrelated to the
  release.
