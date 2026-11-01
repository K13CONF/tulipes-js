# Review fixes — November 2026

Two findings from an outside review, fixed on `feat/client-headers` on
2026-11-01 after the client-headers sprint. Verified locally only: not through
CI, not released.

## R01 — docs contradicted themselves

- The root README called 0.11 the stable line. `docs/support.md`, the core
  README and npm say 0.13.2. The README now says 0.13, and the core and mcp
  READMEs scope their experimental warning to 0.13. The mcp README also said
  it needs core 0.11; its manifest requires `^0.13.0`.
- README, SECURITY.md, `docs/releasing.md` and a publish workflow comment said
  the repository is private. `gh repo view` reports `PUBLIC`. The publish job
  already sets `NPM_CONFIG_PROVENANCE` from the repository's visibility, so the
  next publish carries provenance with no workflow change.
- Sprint records under `docs/sprints/` that say "private" are history and stay.

## R02 — any module could grant any id, or `*`

`AclBuilder.allow()` checked the grant's shape and duplicates, not who made it.
A feature module could grant `guest` the users back office, or `*`, and the
boot said nothing. Now a module grants only ids starting with its own name;
only the module that defined the role may grant another module's ids or `*`.
Anything else is an `acl` boot issue naming both modules.

- Both presets already follow the rule (the auth module, or the minimal core
  module, defines the roles and holds the cross-module grants).
- Breaking for an app that relied on the old behavior: MIGRATING and the core
  CHANGELOG say so under "Unreleased". Per `docs/releasing.md` a breaking core
  change means the next core minor, 0.14, and a core bump repacks every package.

Evidence (local, Node 24, MongoDB and Redis on localhost):

| Check | Result |
|---|---|
| `pnpm typecheck`, `pnpm test:types` | clean |
| root `pnpm test` with `TEST_MONGO_URI`/`TEST_REDIS_URL` | 42 files, 486 passed, including the new ACL ownership test |
| example suite | 186 passed, 8 skipped (agents live eval) |
| site `pnpm build && pnpm check` | 350 pages, passed |

## Backlog

- Granting `*` to `guest` is allowed from the role's owner. It is almost
  certainly a mistake; decide whether that combination should refuse the boot.
- A grant naming a module that does not exist (`billng:*`) is still silent.
  The production preset without queues keeps `agents:*` in the auth grants
  after dropping the agents module, so this check needs the template to drop
  that grant first.
