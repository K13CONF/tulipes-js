# Working in this repository

This is the Tulipes monorepo: the runtime (`packages/core`), the command line
(`packages/cli`), the spec generator (`packages/spec`), three infrastructure
providers (`packages/mongoose`, `packages/bullmq`, `packages/socket.io`) and
the reference application (`example/`) they are developed against.

Writing an *application* with Tulipes is a different job from working on the
framework itself. For the first, read [`example/AGENTS.md`](./example/AGENTS.md)
— the same file every generated app gets. This file is about changing the
framework.

## Commands

| Command | Use |
|---|---|
| `corepack enable && yarn install` | once per machine; yarn 4 is pinned |
| `yarn typecheck` | every public workspace |
| `yarn test` | the suite; needs `TEST_MONGO_URI` and `TEST_REDIS_URL` |
| `yarn test:types` | the `.test-d.ts` type fixtures |
| `yarn test:coverage` | the suite with the thresholds CI enforces |
| `yarn example` | boot the reference app (MongoDB and Redis required) |
| `yarn install --immutable` | what CI runs — a stale lockfile fails the build |

Integration tests skip without services and CI refuses that, so run them with
both variables set before claiming a suite passed.

## Layout and boundaries

- **Core owns no infrastructure.** A database, queue or socket driver belongs
  in its provider package behind the seam in `packages/core/src/boot/providers.ts`.
  Core must not gain a dependency that an app declaring no providers would
  install; `scripts/artifacts.mjs verify` fails the build if it does.
- **The reference app is generated output, not hand-written.** `example/` must
  match what `tulipes init --preset production` produces; CI diffs them. Change
  the generator in `packages/cli/src/init.ts`, then mirror into `example/`.
  The same goes for `packages/cli/templates/` versus `example/AGENTS.md`,
  `example/CLAUDE.md` and `example/.claude/`.
- **Generated apps are the user's code.** Auth, settings, the cache and the
  nginx templates are scaffolded for editing, so fixes there ship as migration
  steps, not as library changes.
- Tests live beside their package. A provider's tests belong to the provider.

## Evidence, not assertion

- Say what was verified and how. Distinguish a local run from CI, and CI from a
  published release. "Tests pass" means the command was run and its output read.
- Operational harnesses in `scripts/` produce the evidence the test suite
  cannot: packed and registry installs of both presets, the upgrade path from
  the previous line, the committed nginx template in front of a real app
  (`ingress-smoke.mjs`), and service failure against a three-node MongoDB
  replica set (`failure-smoke.mjs`). They need Docker and disposable services.
- When a harness disagrees with an expectation, suspect the harness first and
  prove which is wrong before recording a finding.
- Record measurements with the conditions that produced them. `docs/design/`
  holds the inventories and evidence files; keep the numbers reproducible.

## Sprint workflow

- Before starting or resuming a change set, read the active plan in `docs/sprints/`
  and identify the sprint item and acceptance criteria it serves.
- Keep changes within that scope. Record newly discovered work in the sprint
  backlog instead of silently expanding the current change set.
- Update the sprint tracker with completed work, validation evidence and remaining
  tasks. Distinguish local verification from CI or release verification.
- Commit each coherent change set after its required checks pass, before starting
  the next set. Include the sprint item in the commit message and report the hash.
- Preserve unrelated user changes. Committing does not authorize pushing,
  publishing, merging or changing repository visibility.

## Releasing

Versions, ranges and publication follow [`docs/releasing.md`](./docs/releasing.md).
Two things that have caught people: packing rewrites every workspace package's
core dependency, so a core version bump changes **all** archives and each one
needs a new version; and publication is gated on a tag whose name matches
core's version. Publishing is an authorized operation, never a side effect of
merging.
