# Release — core 0.13.0, the 0.13 line, stable

Status: **published on 2026-10-15** to npm's `latest` tag, from `v0.13.0`
on `a61bf13`. No candidate was
published for this line: the prepared `0.13.0-rc.1`
([record](./release-0.13.0-rc.1.md)) was never tagged, and on 2026-10-15
the maintainer chose to publish 0.13.0 directly. Owning items: S01–S05 of
[the 0.13 plan](./0.13-plan.md) and the [agents module
design](../design/agents-module-design.md).

## Scope

Additive over 0.12.0 — an app on 0.12 runs unchanged:

- **Credential scopes** in the `rai()` and `ctx.agent.invoke()` gates
  (403 `OUT_OF_SCOPE`, `scopesCover()`); a custom access checker decides
  alone, scopes included (MIGRATING).
- **`@tulipes/mcp`: the app as its own MCP server** (`serveMcp`,
  `defineMcp`, `developmentIdentity`): stdio and Streamable HTTP, the
  latter refusing a foreign Host on loopback and a body over 1 MiB.
- **API tokens** in the reference app's auth module; `Auth.credentialId`.
- **The `agents` module** (production preset, experimental): Claude inside
  the app as a harness — runs as queue jobs, as the person who started
  them, with approval of writes, budgets, loop detection, resumable after
  a crash; eight endpoints.
- **`tulipes migrate 0.13`**; `tulipes init --no-queues` leaves the agents
  module out.
- Packages: core `0.13.0`, `@tulipes/cli` `0.4.0`, `@tulipes/mcp` `0.2.0`
  (core `^0.13.0`), and republished for their core range: `@tulipes/spec`
  `0.4.1`, `@tulipes/mongoose` and `@tulipes/bullmq` `0.2.2`,
  `@tulipes/testing` `0.1.2`, `@tulipes/socket.io` `0.1.4`. Eight
  archives, dist-tag `latest`.

## Known limits, stated

- **The agents module's live evaluation has not been run.** It needs a
  Claude API key, and none is available for this release. The harness is
  proven against a scripted model (the loop, the adapters, the door, the
  resume and approval paths, 48 tests and the adapter's request shapes),
  not against the real model's behaviour: how well it pursues goals, and
  whether it resists an instruction planted in data, is unmeasured. The
  eight-goal eval is in the module
  (`AGENTS_LIVE=1 … vitest run modules/agents/tests/live.test.ts`) for the
  first deployment that has a key. This is why the module is documented
  as experimental.
- The two rate-limit tests of the reference app fail on macOS (201
  parallel connects against `kern.ipc.somaxconn=128`), as on every release
  since 0.12; Linux CI runs them.
- `ingress-smoke.mjs` and `failure-smoke.mjs` need Docker and were not run.

## Evidence

Local: this Mac, 2026-10-15, Node 24.14.0, pnpm 10.28.0 (corepack),
MongoDB 7.0 and Redis 7.2 on 127.0.0.1, no Docker. Every job of
`.github/workflows/verify.yml`, on the commit that is tagged.

| Check | Local | CI |
|---|---|---|
| frozen install, `typecheck`, `test:types` | pass, lockfile unchanged by the bumps | pass |
| `test:coverage` (MongoDB, Redis, `REQUIRE_INTEGRATION_TESTS=1`) | 40 files, 413 passed, 0 skipped; 94.84 % statements, 91.37 % branches, 94.08 % functions, 95.92 % lines; the agents harness 97.97 / 94.21 / 100 / 100 against its own floor | pass |
| example `sync` + `typecheck`, guide parity | pass, no drift | pass |
| `artifacts.mjs prepare` + `verify`, `audit.mjs`, scaffold parity | eight archives verify; audit clean; parity pass | pass |
| smokes: minimal, production offline, composition, upgrade | pass (minimal includes the MCP smoke; upgrade: 0.11.0 → `migrate 0.12` → `migrate 0.13` → boots on the 0.13.0 archives) | pass |
| production smoke (services) | the app's suite 98 passed, 8 skipped (the live eval), 2 failed (the macOS rate-limit pair); with only the test step skipped: boot, worker with `agents.run`, start, MCP and pm2 smokes pass | pass on Linux, the rate-limit pair included |
| MCP cold start | 452 ms median to `initialize` ([measurements](../design/0.13-measurements.md)) | — |
| agents live eval | **not run: no key** | — |

## Publication

- Merge commit `a61bf13` on `master`; CI on it passed
  ([run 38739971251](https://github.com/kemora13conf/bp-backend-express/actions/runs/38739971251)).
- Tag `v0.13.0` on `a61bf13`; the publish workflow re-ran the verify jobs
  and published the eight archives
  ([run 38742088173](https://github.com/kemora13conf/bp-backend-express/actions/runs/38742088173)).
- Registry: each of the eight versions' `dist.integrity` matches the
  digest in the run's `manifest.json` (commit `a61bf13`); `latest` is core
  0.13.0, cli 0.4.0, mcp 0.2.0, spec 0.4.1, mongoose and bullmq 0.2.2,
  testing 0.1.2, socket.io 0.1.4. The registry served the last four a few
  minutes after the run ended. `next` still names the 0.12 candidates.
