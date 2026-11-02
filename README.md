<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="packages/core/assets/brand/lockup-horizontal-dark.svg">
  <img src="packages/core/assets/brand/lockup-bloom.svg" alt="tulipesjs" width="440">
</picture>

**The Express framework that refuses to start when something is wrong.**

[![npm](https://img.shields.io/npm/v/@tulipes/core?color=%23cb3837&label=%40tulipes%2Fcore)](https://www.npmjs.com/package/@tulipes/core)
[![npm](https://img.shields.io/npm/v/@tulipes/cli?color=%23cb3837&label=%40tulipes%2Fcli)](https://www.npmjs.com/package/@tulipes/cli)
[![npm](https://img.shields.io/npm/v/@tulipes/spec?color=%23cb3837&label=%40tulipes%2Fspec)](https://www.npmjs.com/package/@tulipes/spec)

</div>

---

This is the Tulipes monorepo — the runtime, the command line, the spec
generator, the infrastructure providers, and the reference app they are all
developed against.

```sh
npm install -g @tulipes/cli
tulipes init my-api          # --preset production for the full application
```

| | |
|---|---|
| [`packages/core`](./packages/core) | `@tulipes/core` — the runtime: boot pipeline, environment contract, ACL, routing, translations, the provider seam |
| [`packages/cli`](./packages/cli) | `@tulipes/cli` — the `tulipes` command: scaffold, sync, inspect, describe, run |
| [`packages/spec`](./packages/spec) | `@tulipes/spec` — OpenAPI 3.1 and Postman from shared route declarations |
| [`packages/mongoose`](./packages/mongoose) | `@tulipes/mongoose` — the `models` provider |
| [`packages/bullmq`](./packages/bullmq) | `@tulipes/bullmq` — the `queues` provider |
| [`packages/socket.io`](./packages/socket.io) | `@tulipes/socket.io` — the `sockets` provider |
| [`packages/mcp`](./packages/mcp) | `@tulipes/mcp` — `tulipes-mcp`, an MCP server over an app's agent tools |
| [`packages/testing`](./packages/testing) | `@tulipes/testing` — boot an app for a test file, call it, sign in as a role |
| [`example`](./example) | the reference application: six modules, exercising every contract |

Start with **[packages/core/README.md](./packages/core/README.md)** — that is
the documentation. This file only says where things live, and
[AGENTS.md](./AGENTS.md) says how to work in here (coding agents read it by
convention; it is worth a human's time too).

An app installs the runtime and declares the infrastructure it wants; core
itself pulls in no database, queue or socket driver.

## Working in here

```sh
npm install -g pnpm      # once per machine; the pinned pnpm line switches in on first use
pnpm install
pnpm typecheck           # every public workspace
pnpm test                # needs TEST_MONGO_URI and TEST_REDIS_URL
pnpm example             # boot the reference app (needs MongoDB and Redis)
```

The example is not a demo kept alive by hand: CI scaffolds a fresh app with
`tulipes init --preset production` and diffs its `modules/` against
`example/modules/`, so the two cannot drift.

Beyond the test suite, `scripts/` holds the harnesses that produce operational
evidence — packed and registry installs of both presets, the upgrade path from
the previous line, the committed nginx template in front of a real app, and
service failure against a three-node MongoDB replica set. They need Docker and
disposable services; [Testing](docs/testing.md) says which is which.

## Quality and support

Default `tulipes init my-api` creates a minimal API without MongoDB or Redis.
`--preset production` gives the full reference application, and `--no-queues` /
`--no-sockets` compose it without those providers. Node 24.x is the supported
runtime. Both presets include Vitest tests.

The 0.13 line is stable: core 0.13.2 is on npm's `latest` tag. 0.14.0-rc.1 is on `next`: it is breaking, and carries the fixes from the November 2026 security audit (see `packages/core/MIGRATING.md`, "0.14.0 — upgrading from 0.13"). Coming from an older line, read `packages/core/MIGRATING.md` oldest-first; `tulipes migrate 0.11`, `0.12` and `0.13` carry an app across each step.
It is not production-proven — no pilot deployment has run this framework, so
there is no load, backup-restore or multi-replica evidence and no independent
security review. [Support](docs/support.md) states that in full, and the
[production readiness programme](docs/sprints/production-readiness-task-report.md)
records what closing it would take.

See [Testing](docs/testing.md), [Contributing](CONTRIBUTING.md),
[Security](SECURITY.md), [Support](docs/support.md) and
[Releasing](docs/releasing.md). Publication requires the complete reusable CI
workflow and installs/tests the exact archives that will be uploaded to npm.
The repository is public: source, issues and CI runs are open to read.

---

<div align="center">
<sub>Built by <b>k13.conf</b></sub>
</div>
