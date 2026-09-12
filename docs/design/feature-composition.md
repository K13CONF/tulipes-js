# Feature composition (S14)

Status: decided and delivered on 2026-09-12 against `eaaef83`. Two named
presets stay; the production preset gains two opt-outs (`--no-queues`,
`--no-sockets`) that are validated before any file is written and exercised
by packed smokes. Auth and settings remain generated application code (S14.4
deferral recorded in §4).

## 1. Supported combinations and prerequisites (S14.1)

| Combination | Command | Modules | Providers | Infrastructure | Status |
|---|---|---|---|---|---|
| minimal | `tulipes init --preset minimal` (default) | core, security, hello | none | none | supported, tested (packed minimal smoke, Ubuntu + macOS) |
| production | `tulipes init --preset production` | core, security, auth, users, settings, hello | models, queues, sockets | MongoDB, Redis | supported, tested (packed production offline + runtime, registry smokes, upgrade) |
| production without queues | `… --preset production --no-queues` | same; no `queues/` files, no `worker.ts`, no PM2 worker | models, sockets | MongoDB, Redis (cache, rate limiter) | supported, tested (packed runtime) |
| production without sockets | `… --preset production --no-sockets` | same; no `sockets/` files | models, queues | MongoDB, Redis | supported, tested (packed offline) |
| production without both | `… --no-queues --no-sockets` | same; neither | models | MongoDB, Redis | supported, tested (packed offline + runtime with PM2) |

Prerequisites the generator encodes:

| Feature | Needs | Why |
|---|---|---|
| auth | models (sys `core` module's `MONGO_URI`), the `security` module | `Credential`, `Session`, `RevokedToken` models; rate limits |
| users | auth, models; queues only when generated with them | seeds and reads `User`; enqueues the welcome job only in the queues variant |
| settings | auth, core, models | sysadmin role, audit model, PM2 helpers |
| hello (production) | models; queues/sockets only when generated | `Greeting` model; the count job or the in-request update |
| worker process (`yarn worker`, PM2 `<name>-worker`) | queues | a worker with nothing to consume refuses to boot |
| sockets | the backend HTTP server | attach happens before `listen()`; never in worker/script |
| `REDIS_URL` | production, always | the app-owned cache and rate limiter use it even without queues (the "rate limiting without queues" combination of 04-C1) |

Not offered now, and why: `--no-models` on production (auth/users/settings
own models — that is the minimal preset), `--no-auth`/`--no-settings` (see §4),
`--with-queues` on minimal (a queue needs a module that defines it; adding
queues to a running minimal app is `tulipes new module --queues` plus the
declaration, which the CLI already prints). Additional flags are not worth
supporting until a user journey asks for them.

## 2. Rejection before writing files (S14.2)

`initArguments` in `packages/cli/src/main.ts` parses every flag first and
throws — exit code 2, no file created — on: unknown flags, `--preset` without
a value or with an unknown one, conflicting presets, a second positional,
and `--no-queues`/`--no-sockets` with the minimal preset (nothing to leave
out). `runInit` still refuses a non-empty target. Tests:
`packages/cli/tests/presets.test.ts` ("rejects invalid init arguments before
writing files", seven cases).

## 3. Generating only what was selected (S14.3)

`renderProject(name, core, cli, features)` threads `features` through the
production templates and filters the output: root manifest (`tulipes.providers`,
`worker` script, provider dependencies), `tsconfig` include, PM2 ecosystem
(worker app), module manifests, the users and hello controllers (enqueue vs
in-request update, `requireQueues` import), README rows, and the post-init
hints. `queues/`, `sockets/` and `worker.ts` are dropped by path. Nothing
generated imports an absent feature: the variant typechecks and boots from
packed archives (§5). The generated test suite has no queue/socket cases, so
it needs no variant.

## 4. Auth and settings ownership (S14.4) — deferred, recorded

Auth (credentials, sessions, refresh families, rate limits, browser policy)
and settings (sysadmin console, variable/translation editing, PM2 restart,
log streaming, audit) stay **generated, editable application code**. A
library would have to answer, per app: how credential hashing, role names,
audit write concern, file-access constraints and restart scoping are
customized without forking; how a security fix reaches an app that edited
any of it; and how the settings module's direct file editing survives a
library boundary. Sprint 02's fixes landed as generated-code migrations for
exactly this reason and were absorbed by the reference app in one PR each.
Until a second application exists to show which parts are actually shared
unchanged, extracting them would freeze policy that is still moving. Revisit
after the production pilot (Sprint 06).

## 5. Executable compatibility (S14.5)

| Row (04-C1) | Where |
|---|---|
| core only | inventory fixture A; minimal smoke launcher |
| models only | `packages/mongoose` integration tests |
| queues with a worker | `packages/bullmq` integration tests; packed production runtime |
| sockets with HTTP | `packages/socket.io` integration test |
| production with all providers | packed production runtime, registry smoke, upgrade |
| rate limiting without queues | packed `production --no-queues` runtime (Redis used by the app alone) |
| production without both providers | packed `production --no-queues --no-sockets` offline and runtime (PM2 with one app process) |

`scripts/scaffold-smoke.mjs` accepts `--no-queues`/`--no-sockets`; its
absence probe expects the omitted provider's driver to be unresolvable from
the app; `pm2-smoke.mjs` derives the owned process count from the ecosystem.
CI adds the `composition` job (offline, no services) for the variant without
both providers; the runtime variants were run locally and are recorded in
§6. Tested package ranges are the generated ones (`^<bundled core>`, spec
`^0.3.0-rc.5`, providers `^0.1.0-rc.x`, CLI `^0.1.0-rc.1`).

## 6. Evidence (2026-09-12)

| Check | Result |
|---|---|
| Full production parity (`init --preset production` vs `example/`) | identical |
| `--no-queues --no-sockets`: generated shape (presets test) | pass |
| Invalid flags rejected before writing (7 cases) | pass |
| Packed `production --no-queues --no-sockets --offline-only` | pass |
| Packed `production --no-queues --no-sockets` runtime (backend, login, start, PM2 with one process) | pass |
| Packed `production --no-sockets --offline-only` | pass |
| Packed `production --no-queues` runtime (sockets on, rate limiter on Redis, no worker) | pass |
| Suite, coverage, types, immutable install, parity | pass |
