# Release — 0.10.1

Status: prepared on 2026-09-12; **tag and publication blocked**, see below.
Patch release on the stable 0.10 line: no runtime change, no migration.

| Package | Version |
|---|---|
| `@tulipes/core` | 0.10.1 |
| `@tulipes/cli` | 0.1.1 |
| `@tulipes/spec` | 0.3.1 |
| `@tulipes/mongoose` | 0.1.1 |
| `@tulipes/bullmq` | 0.1.1 |
| `@tulipes/socket.io` | 0.1.1 |

## Contents

- Generated apps ship `AGENTS.md` — the cross-tool agent convention — with
  `CLAUDE.md` reduced to a bridge pointing at it (`@tulipes/cli`).
- Core, spec and the three providers carry no source change; they are
  republished because packing rewrites each one's core dependency to the
  concrete version. Provider peer ranges stay `^0.10.0`, which admits 0.10.1.
- Repository-only: the test fixture no longer leaves its temp directory behind,
  and the READMEs describe the 0.10 line.

## Blocked

GitHub Actions runners have been unavailable since 2026-09-12 17:22 UTC: every
job since then fails in about two seconds having executed **zero steps**, on
master and on pull requests alike, which is what an exhausted Actions
allowance or a spending-limit stop looks like on a private repository. The
publish workflow runs the full verification before publishing, so pushing the
tag now would produce a failed run and no packages — and the release procedure
forbids moving a tag afterwards.

The tag waits for runners. Nothing else does.

## Local validation (2026-09-12, macOS arm64, Node 24.14.0, Yarn 4.18.0)

Run against the merged tree these versions describe:

- `yarn install --immutable`; 267 tests in 27 files with required services;
  coverage 88.1 / 79.5 / 90.6 / 90.0; `test:types`; workspace typecheck.
- Six archives packed and verified.
- Generator/reference parity including `AGENTS.md`, `CLAUDE.md` and `.claude/`.
- Packed minimal and production smokes (backend, worker, login, PM2).

Local runs are not CI. When runners return, the release PR must pass the full
workflow before merging, and the tag workflow must build and publish the exact
archives it verifies.
