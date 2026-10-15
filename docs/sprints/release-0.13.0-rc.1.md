# Release — core 0.13.0-rc.1, the 0.13 line's first candidate

Status: **superseded — never tagged, never published.** On 2026-10-15 the
maintainer took S04 (the agents module) into the line and then chose to
publish 0.13.0 directly as stable, without a candidate; see
[release-0.13.0.md](./release-0.13.0.md). What follows is the record as it
stood.

Originally: **prepared locally, not tagged, not published.** Published to npm's
`next` tag; `latest` stays on 0.12.0. Owning items: S01, S02, S03 and S05 of
[the 0.13 plan](./0.13-plan.md). S04 (a reference agent) is not part of this
candidate. Tagging and publishing are authorized operations, not side effects
of this commit.

## Scope and acceptance

Additive over 0.12.0:

- **Credential scopes** in the `rai()` and `ctx.agent.invoke()` gates
  (`OUT_OF_SCOPE`, `scopesCover()` in `@tulipes/core/acl`).
- **`@tulipes/mcp`: the app as its own MCP server** (`serveMcp`, `defineMcp`,
  `developmentIdentity`), stdio and Streamable HTTP on its own port.
- **API tokens** in the reference app's auth module.
- **`tulipes migrate 0.13`**.
- Packages: core `0.13.0-rc.1`, `@tulipes/cli` `0.4.0-rc.1`, `@tulipes/mcp`
  `0.2.0-rc.1` (core `^0.13.0-rc.1`, it needs `manifest(actor)`), and
  republished for their core range only: `@tulipes/spec` `0.4.1-rc.1` (cli's
  optional spec peer is `^0.4.1-rc.1`), `@tulipes/mongoose` and
  `@tulipes/bullmq` `0.2.2-rc.1`, `@tulipes/testing` `0.1.2-rc.1`,
  `@tulipes/socket.io` `0.1.4-rc.1` (adds `^0.13.0-rc.1` to its range). Eight
  archives, dist-tag `next`.
- Migration: `tulipes migrate 0.13` on an app on 0.12, then the 0.13 section of
  `packages/core/MIGRATING.md`.

## Evidence

Local: this Mac, 2026-10-15, Node 24.14.0, pnpm 10.28.0 (corepack), MongoDB
and Redis on 127.0.0.1, npm registry reachable, no Docker. Every job of
`.github/workflows/verify.yml`, in its order.

| Check | Local | CI |
|---|---|---|
| `pnpm install --frozen-lockfile` | pass, lockfile unchanged by the bumps | to record |
| `pnpm typecheck`, `pnpm test:types` | pass | to record |
| `pnpm test:coverage` with MongoDB, Redis, `REQUIRE_INTEGRATION_TESTS=1` | 38 files, 371 passed, 0 skipped; 93.42 % statements, 90 % branches, 91.53 % functions, 94.27 % lines, above every floor | to record |
| example `sync` + `typecheck`; guide parity diffs | pass | to record |
| `artifacts.mjs prepare` + `verify`, `audit.mjs` | eight archives pack and verify; audit clean | to record |
| scaffold parity diffs against the example | pass | to record |
| `scaffold-smoke.mjs minimal`, `production --offline-only`, `--no-queues --no-sockets --offline-only` | pass | to record |
| `upgrade-smoke.mjs` (0.11.0 → candidate) | pass: refused with the 0.12 diagnostic, migrated with `migrate 0.12` then `0.13` (28 ids scoped, 11 variables keyed), install, sync, typecheck, offline routes and spec, boot on the eight rc.1 archives | to record |
| `scaffold-smoke.mjs production` (services) | **fails on this Mac at the app's own suite**: 46 of 48 pass, the two failures are the rate-limit pair (201 parallel connects, `ECONNRESET`, `kern.ipc.somaxconn=128`), as on 0.12.0-rc.2. Install, sync, typecheck, offline routes and spec passed before it. | to record on Linux |
| the same smoke with only its `test` step skipped (a temporary copy of the script, deleted) | pass: boot, worker, start-smoke, `mcp-smoke.mjs` (stdio MCP process), pm2-smoke | — |
| `ingress-smoke.mjs`, `failure-smoke.mjs` | not run (Docker) | — |
| MCP cold start to `initialize` ([0.13-measurements.md](../design/0.13-measurements.md)) | median 452 ms over five runs (first 992 ms), against 438 ms for the HTTP backend's banner on the same app and machine | — |

## Publication

To record after the tag: the merge commit, the `v0.13.0-rc.1` tag, the publish
run, registry integrity against the manifest, dist-tags and the `--registry`
smokes.
