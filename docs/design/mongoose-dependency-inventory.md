# Mongoose dependency inventory (S09.1)

Status: complete on 2026-09-11 — coupling register, harness and baseline
against `b42bd00` (S09.1a), reproduced at `9aba800` (S09.1b, §4.3), and the
post-extraction comparison at `78bf4eb` (S09.10, §4.4). Design and evidence for
the extraction itself are in the [provider design](mongoose-provider-design.md).

Plan: [Sprint 03 §4](../sprints/production-readiness-03.md#4-s091--inventory-and-baseline-measurements).
Program: [S09.1](../sprints/production-readiness-task-report.md#s09--mongoose-provider-and-capability-contract).
Raw reports: git-ignored `reports/s09-inventory/b42bd00/` (baseline, archives,
search register, fixture manifests/lockfiles, install and startup samples).
Harness: [`scripts/s09-inventory.mjs`](../../scripts/s09-inventory.mjs).

## 1. Baseline identity

| Item | Value |
|---|---|
| Source | `b42bd00c55da6d8c612b987a60e70bc21dc0eafb`, clean apart from the untracked harness during the run |
| Packages | `@tulipes/core` 0.9.0-rc.3, `@tulipes/spec` 0.3.0-rc.3 |
| Archives | Packed from HEAD by `scripts/artifacts.mjs prepare`; core `sha512-p6ObFNMHo+…Q6lg5g==` (348,719 B, 215 files, 1,106,122 B unpacked), spec `sha512-FVkUqn7l…FcasKg==` (14,883 B, 18 files, 48,904 B unpacked). Digests are byte-identical to the archives published as rc.3 on 2026-09-11. |
| Workspace lockfile | `yarn.lock` sha256 `f66606ef…57b9be`; mongoose 8.24.4 → mongodb 6.20.0, bson 6.10.4, kareem 2.6.3, mpath 0.9.0, mquery 5.0.0, sift 17.1.3, mongodb-connection-string-url 3.0.2 |
| Toolchain | Node v24.14.0, Yarn 4.18.0, macOS 26.2 (Darwin 25.2.0) arm64, Apple M3 Pro, 11 cores, 18 GiB |
| Services (fixture C only) | Local MongoDB 8 and Redis 8 containers reachable on 127.0.0.1; each production run uses a unique `tulipes_s09_<hex>` database and Redis db 3. Not the CI service versions — startup numbers for C are comparable only to a rerun on the same host. |
| Sampling policy | Startup: 1 first run + 3 warm-ups + 20 samples per scenario. Installation: 3 fresh-cache + 3 warm-cache runs, all retained. |
| Not measured | Windows/Linux, Node 24.0.0 (CI floor), registry-installed packages (fixtures install packed archives via `file:`), load behavior |

Every fixture lives under the OS temp directory with its own `YARN_CACHE_FOLDER`
and `YARN_GLOBAL_FOLDER`; the developer's `~/.yarn/berry` is neither read nor
cleared. Inherited environment is reduced to `PATH`, `HOME`, `SHELL`, `TMPDIR`,
`LANG`, `TERM`; no `NODE_PATH`, secrets or service URLs leak in.

## 2. Coupling register

One row per contract or dependency path. "Kind" uses the plan's vocabulary:
runtime import, type-only import, package dependency, convention, lifecycle,
test, documentation. "Owner" is the proposed owner after extraction; "Disposition"
is move / adapt / retain / remove / defer. Task ids point at the S09 handoff.

### 2.1 Core package and public declarations

| # | Location and callers | Kind | Current behavior | Owner | Disposition | Compatibility impact | Evidence needed | Closure |
|---|---|---|---|---|---|---|---|---|
| R1 | `packages/core/package.json` `dependencies.mongoose: ^8` | Package dependency | Every core install pulls mongoose and its 18-package graph (§4.1) regardless of preset | Provider | Remove from core; provider declares it | Apps that relied on hoisting must depend on the provider (or mongoose) themselves; every generated production module manifest already declares `mongoose` directly (R19) | Fixture A after extraction: `mongoose`, `mongodb`, `bson` unresolvable from app and core anchors | S09.5 |
| R2 | `packages/core/package.json` `exports["./db"]` (source and `publishConfig`) → `src/db/index.ts` | Public subpath | Exports `initDatabase`, `ModelStore`, `ModelDef`, `BootstrapFn`; also re-exported from the root `.` barrel via `export * from "./db/index.js"` | Provider (`ModelDef`, `ModelStore`, `BootstrapFn`); core drops the subpath or keeps a Mongoose-free stub | Move | Documented import `@tulipes/core/db` in README §exports table, generated models, new-module output and the `tulipes-model` skill breaks; decision in S09.7 (bridge vs breaking prerelease) | Packed core-only consumer compiles without the subpath; migration diagnostic for the old import | S09.2 (compat table), S09.5, S09.7 |
| R3 | `src/boot/boot.ts:3` `import type { Connection } from "mongoose"`; `BootHandle.connection?: Connection` | Type-only import in a public type | Emitted `dist/boot/boot.d.ts` imports mongoose; any consumer of `BootHandle` needs mongoose's declarations to typecheck without `skipLibCheck` | Core (opaque status) / provider (concrete connection) | Adapt: replace with a provider-owned handle or a small status interface | `handle.connection` users (repo tests, `database.integration.test.ts` via `mongoose.connections`) change access path | Packed `.d.ts` grep = 0 mongoose lines (today: 3 across `boot.d.ts`, `database.d.ts`, `model-store.d.ts`) | S09.2 §5.5, S09.5 |
| R4 | `src/boot/boot.ts:14,166` `import { initDatabase }`; phase 8 call with `runBootstrap: mode !== "script" && !options.inspect` and `onConnection: c => handle.connection = c` | Runtime import + lifecycle | Static import means core always loads the driver at import time (§4.2 import cost); ownership registered before `asPromise()` | Core keeps the phase slot; provider owns the body | Adapt: phase 8 invokes the selected provider | None for apps that select the provider; apps without it skip the phase | Boot test: no provider → phase skipped without importing mongoose | S09.2 §5.4, S09.4 |
| R5 | `src/boot/boot.ts` `shutdown()` `cleanup.run("database", () => handle.connection?.close(), () => handle.connection?.destroy(true))` | Lifecycle | Database disposed after queues, after module `onShutdown`, under the shared `Cleanup` deadline; forced path is `destroy(true)` | Core orders; provider implements close/force-close | Adapt: provider registers a disposer at acquisition | None observable if ordering is preserved | Existing `database.integration.test.ts` "shutdown bounds forced database cleanup" retained against the provider | S09.4, S09.9 |
| R6 | `src/boot/boot.ts` failed-boot `catch` → `handle.shutdown()` | Lifecycle | Any failure after `onConnection` (registration, bootstrap, queues, routes, sockets, onReady) closes the connection; cleanup failure becomes an `AggregateError` | Core | Retain | None | Integration tests "releases the acquired connection when model registration fails" / "…schema compilation throws outside the boot report" | S09.9 |
| R7 | `src/boot/contracts.ts:10,37,118-125` `import type { ModelStore }`; `Ctx.models?: ModelStore`; `DatabaseCtx.models: ModelStore`; `requireModels()` | Type-only import + public runtime helper | `ctx.models` is the only model access path; `requireModels` throws "This module requires a database model store" | Provider exports typed access; core keeps an opaque slot or none | Adapt: decide replacement for `ctx.models`, `DatabaseCtx`, `requireModels` (S09.2 §5.5) | Every consumer in §2.3 and every generated bootstrap/controller | `context.test-d.ts` rewritten for the selected contract; packed `.d.ts` free of `ModelStore` | S09.2, S09.6 |
| R8 | `src/boot/index.ts` re-exports `DatabaseCtx`, `requireModels` | Public barrel | Part of `@tulipes/core/boot` | Core/provider per R7 | Adapt | Same as R7 | Same as R7 | S09.2 |
| R9 | `src/boot/banner.ts:52-62` reads `handle.connection.{host,port,name,readyState}` | Runtime access to driver object | Prints `mongodb://host:port/name` and connected/disconnected | Core prints; provider supplies a bounded status | Adapt: `{ label, ready }`-style status without URI secrets | Banner text may change wording | Banner test with a fake status | S09.2 §5.5, S09.4 |
| R10 | `src/db/database.ts` (`initDatabase`, `registerModels`, `runBootstrapTasks`, `ModelDef`, `BootstrapFn`, `MONGO_URI` constant) | Runtime implementation | Reads `MONGO_URI` via `ctx.Environment.store.has/get`; `createConnection(uri, { serverSelectionTimeoutMS: 5000 })`; validates `def.schema instanceof Schema`; `connection.model(name, schema, collection)`; duplicate-owner diagnostic; bootstrap only when `report.issues.length === 0` | Provider | Move wholesale | Behavior preserved; the URI variable stays declared by the app's sys core module (`meta.variables.json`) — provider selection must not be implied by the variable (§3.5) | Moved unit/integration tests; `instanceof Schema` behavior tested across two installs | S09.4 |
| R11 | `src/db/model-store.ts` `ModelStore` (`Model<never>` map, `register_`, `has`, `ownerOf`, `names`, `get<T>`) | Runtime + type | `get<T>` is a caller-side assertion; comment promises typed accessors from `tulipes sync` that do not exist (backlog S09.1-doc) | Provider | Move; fix the comment | Consumers keep `get<T>(name)` if the provider re-exports the class | `boot.test.ts:123-126` moves with the store | S09.4, S09.1-doc |
| R12 | `src/modules/explorer.ts:76-86` `modelFiles` / `bootstrapFiles` collections (`models/*.model.<ext>`, `bootstrap/*.bootstrap.<ext>`) | Convention | Discovery is import-free; files are only executed by `initDatabase` | Core keeps discovery; provider consumes the lists | Retain | None | Explorer tests unchanged | S09.2 §5.3 (does a module *declare* the requirement, or is a model file the declaration?) |
| R13 | `src/modules/manifest.ts` strict zod schema (`tier`, `priority`, `dependsOn`, `offline`) | Convention | Unknown keys are rejected; no capability/requirement key exists | Core | Adapt only if S09.2 adds a static requirement key | New key must be tolerated by older cores or gated by version | Manifest test for the new key and its typo diagnostic | S09.2 §5.3 |
| R14 | `src/boot/inspect.ts` (`inspectRoutes`) | Runtime path | Never touches `initDatabase`, model files or `MONGO_URI`; `inspection.test.ts` proves model files are not imported and `MONGO_URI=invalid` is harmless | Core | Retain | None | Existing `inspection.test.ts` + scaffold offline guard | S09.2 §5.2 (offline must also not import a provider) |
| R15 | `src/cli/inspection.ts` `--runtime` path → `boot({ inspect: true })` | Runtime path | Runtime inspection still connects when `MONGO_URI` is set (bootstrap skipped); banner not printed | Core | Adapt: runtime inspection must read the same provider selection as boot | None beyond the selection contract | Runtime CLI test with provider selected/omitted | S09.2 §5.2, S09.6 |
| R16 | `src/cli/app-core.ts` (`importFromApp`, `appBoot`) and its comment | Runtime resolution | Boots through the app's core so mongoose is a single copy; comment names mongoose explicitly | Core | Adapt comment; keep the app-anchored resolution (the provider must resolve from the app too) | None | Existing CLI tests | S09.6 |
| R17 | `src/cli/sync.ts` | Tooling | Generates `KnownVariables` and config return types without importing module code; no model output | Core | Retain; represent provider configuration only if the selection is a static declaration | None | Existing sync tests | S09.2 §5.6 tooling |
| R18 | `packages/spec/src/extract.ts` | Tooling | Route schemas only; no model metadata | Spec | Retain | None | Existing spec tests | S09.3 (explicitly unsupported model metadata) |

### 2.2 Generators, templates and CLI output

| # | Location and callers | Kind | Current behavior | Owner | Disposition | Compatibility impact | Evidence needed | Closure |
|---|---|---|---|---|---|---|---|---|
| R19 | `src/cli/init.ts` production preset: `modules/{auth,users,settings,hello,core}/package.json` and root `package.json` declare `mongoose: ^8` (lines 2860, 3240, 4986, 5004, 5906 and root) | Generated package dependency | Application-owned dependency, correct today and after extraction | Application | Retain; add the provider dependency to the app root and wherever selection lives | Production apps keep mongoose; generated ranges must match the provider's peer range | Generated/reference parity (`diff -r … example/modules`) | S09.6 |
| R20 | `src/cli/init.ts` model files: `import { Schema } from "mongoose"` + `import type { ModelDef } from "@tulipes/core/db"` (Credential 2695, Session 2730, RevokedToken 2776, User 2874, AuditEvent 3302, Greeting 6084) | Generated runtime + type import | `ModelDef` comes from core | Application (schema) / provider (`ModelDef`) | Adapt import path | Every generated model file changes one import; `example/modules/*/models/*.model.ts` identical | Parity diff; packed production smoke | S09.6, S09.7 |
| R21 | `src/cli/init.ts` bootstrap files: `import type { DatabaseCtx } from "@tulipes/core/boot"` (`seed-admin` 2800, `seed-greetings` 6112) | Generated type import | `ctx.models.get(...)` on `DatabaseCtx` | Provider type | Adapt | Same as R7 | Parity diff | S09.6 |
| R22 | `src/cli/init.ts:6176-6204` `greetings.controllers.ts` `requireModels(this.ctx).get("Greeting")` | Generated runtime helper | Explicit capability check | Provider helper | Adapt | Same as R7 | Parity diff | S09.6 |
| R23 | `src/cli/init.ts:5297-5534` `modules/core/helpers/mongoose/**` (types, timestamps, soft-delete, base plugin, `register.ts` with `mongoose.plugin(baseModelPlugin)` and a module-level `registered` guard) + `modules/core/index.ts` exports + `module.config.ts` calling `registerBasePlugins()` at import | Generated application policy (global plugin) | Registered during phase 6 module-config import, before phase 8 compiles models; guard is per module instance, plugin registration is per mongoose instance | Application | Retain; provider must compile models with the same mongoose instance the app's `register.ts` imported | If provider bundles its own mongoose copy the global plugin silently misses → timestamps/soft-delete lost | Two-boot test and separately installed app (backlog S09.2-plugin) | S09.2 §5.6, S09.9 |
| R24 | `src/cli/init.ts:1683` `import type { HydratedDocument, Types } from "mongoose"` in `auth/helpers/documents.ts`; `users.controllers.ts`, `auth.controllers.ts`, `passport.ts`, `passwords.ts`, `tokens.ts`, `access-check.ts`, `settings/helpers/audit.ts` use `ctx.models!.get(...)` | Generated consumers | Non-null assertion on the optional `ctx.models` | Application | Adapt to the selected accessor | Same as R7; audit write concern `{ w: "majority", j: true, wtimeout: 5000 }`, refresh update pipelines and TTL indexes must be untouched | Sprint 02 security regressions in `example/tests/app.test.ts` (24 `models!` uses) retained | S09.6 |
| R25 | `src/cli/minimal.ts` `renderMinimalProject` | Generated preset | No model, bootstrap or `MONGO_URI`; root deps `@tulipes/core`, `express`, `zod`; `presets.test.ts:60` asserts `ctx.models === undefined` | Application | Retain; must not gain the provider | Minimal is the S09.5 absence fixture | Fixture B after extraction cannot resolve mongoose | S09.5 |
| R26 | `src/cli/new-module.ts:89,201-232` always emits `models/<name>.model.ts`, `bootstrap/<name>.bootstrap.ts` and `mongoose: ^8` | Generated output | Works in a minimal app today only because core hoists mongoose; after extraction the model import breaks unless the provider is installed | Tooling | Adapt: clear failure, explicit `--model` option, or provider-free output (S09.2 §5.6) | New-module behavior changes in provider-free apps | CLI test for both app shapes | S09.2, S09.6 |
| R27 | `packages/core/templates/CLAUDE.md`, `templates/claude/skills/tulipes-model/SKILL.md`, `tulipes-boot-errors`, `tulipes-env-variable` (and the `example/` copies checked by CI `diff`) | Documentation | Teach `@tulipes/core/db`, `ctx.models`, `MONGO_URI` requirement messages | Tooling | Adapt with the contract | CI parity diff between templates and example | Parity job | S09.6 |
| R28 | `packages/core/README.md:331,474`, `MIGRATING.md:529`, `CHANGELOG.md:92`, `docs/framework-poc.md`, `docs/testing.md` | Documentation | Public statements of the current contract | Maintainer | Adapt | None | Link/consistency check | S09.7, S09.10 |

### 2.3 Reference application (`example/`)

| # | Location and callers | Kind | Current behavior | Owner | Disposition | Compatibility impact | Evidence needed | Closure |
|---|---|---|---|---|---|---|---|---|
| R29 | `example/package.json` and `modules/{auth,core,hello,settings,users}/package.json` `mongoose: ^8` | Package dependency | Application-owned | Application | Retain + add provider | Same as R19 | Parity | S09.6 |
| R30 | `example/modules/core/meta.variables.json` `MONGO_URI` (type url); `.envs/.env.{development,production,staging}`, `.env.example`, `types/config.d.ts` `KnownVariables.MONGO_URI` | Convention (declared variable) | The variable's presence is what enables phase 8 today | Application declares; provider reads | Retain declaration; selection must become explicit (§3.5) | A leftover `MONGO_URI` in a provider-free app must be inert | Boot test: URI set, provider not selected → no connection | S09.2 §5.2 |
| R31 | `example/modules/core/helpers/mongoose/**`, `core/index.ts`, `core/module.config.ts` | Application policy | As R23 | Application | Retain | As R23 | As R23 | S09.6 |
| R32 | Model files (`auth/models/{credential,session,revoked-token}`, `users/models/user`, `hello/models/greeting`, `settings/models/audit-event`) | Runtime import of `Schema` + type import of `ModelDef` | As R20; `credential` is `select: false`; session has TTL/index assumptions | Application | Adapt import | As R20 | Parity, Sprint 02 tests | S09.6 |
| R33 | Bootstrap files (`auth/bootstrap/seed-admin`, `hello/bootstrap/seed-greetings`) | Type import `DatabaseCtx` | Seed admin handles the backend/worker duplicate-key race (`code 11000`) | Application | Adapt import | As R21 | Existing tests | S09.6 |
| R34 | `ctx.models!` consumers (`auth/helpers/{passport,passwords,tokens,access-check}`, `auth/controllers`, `users/controllers`, `settings/helpers/audit`) and `requireModels` in `hello/controllers/greetings` | Runtime access | As R24 | Application | Adapt | As R24 | Sprint 02 security tests | S09.6 |
| R35 | `example/tests/app.test.ts` (24 `models!` uses, `TEST_MONGO_URI` stub) and `src/cli/minimal.ts` `starterTests(true)` (same file rendered by the generator) | Test | Reach collections directly for spying (`.collection.findOneAndUpdate` etc.) | Application | Adapt access path only | None | Generated/reference parity of the test file | S09.6 |

### 2.4 Repository tests, scripts and CI

| # | Location and callers | Kind | Current behavior | Owner | Disposition | Compatibility impact | Evidence needed | Closure |
|---|---|---|---|---|---|---|---|---|
| R36 | `packages/core/tests/database.integration.test.ts` (4 tests, `import mongoose` for `mongoose.connections` leak checks) | Test | Registration failure, schema throw outside the report, inspection skips bootstrap, forced cleanup deadline | Provider package tests | Move | None | Same four scenarios pass against the provider | S09.4, S09.9 |
| R37 | `packages/core/tests/boot.test.ts:123-126` (`ModelStore`/`requireModels`), `context.test-d.ts` (`models` phase typing), `presets.test.ts:60,79` (`ctx.models` undefined; `MONGO_URI=""`), `inspection.test.ts` (model file never imported; `MONGO_URI=invalid`) | Test | Contract assertions on the current types | Core/provider | Adapt to the selected contract | None | Rewritten assertions | S09.2b, S09.9 |
| R38 | `scripts/artifacts.mjs` `packages = ['core','spec']`, `manifest.packages.length !== 2`, digest/license/exports/bin checks, immutable-version preflight | Tooling | Exactly two archives | Tooling | Adapt: generalize the inventory, keep every check | Release workflow expects two artifacts | Artifact tests | S09.8 |
| R39 | `scripts/scaffold-smoke.mjs` installs **all** archives into the CLI launcher and adds all as `resolutions` to the app; minimal smoke asserts `ctx.models === undefined` | Tooling | An all-archive launcher hoists the provider next to a "minimal" app (backlog S09.8-isolation) | Tooling | Adapt: core-only launcher for the minimal job | Minimal CI job proves absence only after this change | Fixture A/B resolve probe = absent | S09.8 |
| R40 | `.github/workflows/verify.yml` `tests` job (Mongo/Redis services, `REQUIRE_INTEGRATION_TESTS`), `pack` parity diffs, `minimal`/`production` smoke jobs | CI | Two-archive assumptions; parity diffs cover templates and generated modules | Tooling | Adapt with R38/R39 | New provider package needs a job matrix entry | Green workflow on the exact archives | S09.8 |
| R41 | `yarn.lock` entries (26 hits) for mongoose, mongodb, bson, saslprep, kareem, mpath, mquery, sift, mongodb-connection-string-url, whatwg-url, tr46, webidl-conversions | Package dependency (workspace) | Hoisted once for the workspace; the example and its modules keep them after extraction | Workspace | Retain (moves to provider + example) | None | Fixture inventory, not the workspace tree, is the evidence | S09.5 |

## 3. Behavior maps

### 3.1 Connection ownership per outcome (current)

| Outcome | Where it fails | Ownership at that moment | Cleanup |
|---|---|---|---|
| Successful boot | — | `handle.connection` set inside `createConnection` → `onConnection` → before `asPromise()` | `shutdown()` closes after queues, forced `destroy(true)` under the shared deadline |
| Connection failure | `asPromise()` rejects (5 s server selection) | Already registered on the handle | `dbReport.throwIfAny` → boot `catch` → `handle.shutdown()` closes the half-open connection |
| Schema/registration failure | `registerModels` (not `ModelDef`, duplicate owner, `connection.model` throws) | Registered; `ctx.models` set to a partial store | Same path; `import` errors are aggregated via `importFile`, but a throw from `connection.model` escapes the report and still reaches the `catch` (covered by test R36 #2) |
| Bootstrap failure | `runBootstrapTasks` (throws are caught per file into the report) | Registered; store complete | Same path |
| Later phase failure (queues, routes, sockets, listen, onReady) | After phase 8 | Registered; store complete | Same path |
| Repeated shutdown | — | — | `shutdownPromise` memoized; signal handlers removed on first call |
| Two boots in one process | — | Each handle owns its own connection; `ModelStore` is per boot | Global `mongoose.plugin` registration is process-wide (R23) — the second boot inherits the first's plugins; harmless with one app, untested with two different apps |

### 3.2 Model registration semantics

- Load order: module order (sys → app, priority, `dependsOn`), then directory listing order of `models/`.
- Duplicate names: first registrant wins; the second module gets `model "X" is already registered by module "Y"` in the aggregate report.
- Validation: `typeof def.name === "string"` and `def.schema instanceof Schema` — the `instanceof` check is what breaks when two mongoose copies exist (app vs CLI, or app vs a future provider). `app-core.ts` exists to prevent that for the CLI.
- Collection naming: `def.collection` overrides mongoose's pluralisation; otherwise driver default.
- Models are compiled on the boot's own `createConnection` instance, never on `mongoose.model()`.

### 3.3 Bootstrap per mode (current)

| Mode / shape | Connection | Models | Bootstrap |
|---|---|---|---|
| backend | yes if URI | yes | yes |
| worker | yes if URI | yes | yes (both processes race; seed handles `11000`) |
| script | yes if URI | yes | **skipped** (`runBootstrap: false`) |
| runtime inspection (`--runtime`) | yes if URI | yes | skipped |
| offline inspection / `sync` / `spec --offline` | never | never imported | never |
| Models declared, no URI | — | — | Boot refused: `modules declare models but "MONGO_URI" is not declared/set` |
| No models, URI set | connects anyway | empty store, `ctx.models` defined | bootstrap files run against the empty store |
| Bootstrap-only module, no URI | — | — | **silently skipped** (no diagnostic) — record as a current gap for S09.2 §5.3 |

### 3.4 Plugin and consumer behavior to preserve (production)

- Global `baseModelPlugin` (timestamps `created_at`/`updated_at`, soft-delete fields/methods/query guards) registered at phase 6 import of `modules/core/module.config.ts`; applies to every schema compiled afterwards in backend, worker and script.
- `Credential` is `select: false`; `Session` binds to credential versions and device families (S08b/S08c/S08k); `AuditEvent` writes with `{ w: "majority", j: true, wtimeout: 5000 }` before settings actions (S08d); `RevokedToken` lookups use `countDocuments().limit(1)`.
- Seed admin creates User + Credential with race handling; seed greetings idempotent.
- All are application code; extraction must only change their import paths and access helper.

### 3.5 Selection today is implicit

Phase 8 runs whenever the app's declared `MONGO_URI` has a value. Nothing else opts in. Consequences the S09.2 contract must resolve (plan §5.2): installing a provider must not enable it; a leftover `MONGO_URI` must not acquire a provider; runtime inspection, worker, script and backend must read one selection.

### 3.6 CLI entrypoints touching the database path

| Entry | Path | Database involvement |
|---|---|---|
| generated `app.ts` / `worker.ts` / `tulipes dev` | `boot()` via the app's own core | full phase 8 |
| `yarn script scripts/x.ts` | `boot({ mode: "script" })` | connection + models, no bootstrap |
| `tulipes routes` / `tulipes spec` (default, offline) | `inspectRoutes` | none |
| `tulipes routes --runtime` / `spec --runtime` | `boot({ inspect: true })` | connection + models |
| `tulipes sync`, `tulipes env:check` | meta discovery only | none (declares `MONGO_URI` type) |
| `tulipes new module` | file generation | emits model + bootstrap + mongoose dependency (R26) |
| `tulipes init --preset minimal` | generation | none in output; core still installs mongoose (R1) |

### 3.7 Metadata consumers

None found. `@tulipes/spec` reads `RouteRegistry` entries (zod schemas on `rai()`); the generated `docs/openapi.json` / `collection.json` contain no model-derived content. Preferred S09.3 decision stands: leave model documentation explicitly unsupported.

### 3.8 Hardcoded inventories

`scripts/artifacts.mjs` (two packages, `length !== 2`), `scripts/scaffold-smoke.mjs` (all archives into the launcher), `verify.yml` job names/artifact names, `init.ts`/`minimal.ts` generated ranges (`@tulipes/core` `^<version>`, `@tulipes/spec` `^0.3.0-rc.3`), `packages/spec` peer range on core. All to S09.8.

## 4. Measurements

Raw samples: `reports/s09-inventory/b42bd00/{install,startup}.json`;
`summary.md` in the same directory is generated by `node scripts/s09-inventory.mjs summary`
and is the source of every figure below.

### 4.1 Installation shapes

| Fixture | Unique name@version | Physical copies | Duplicated names | Installed bytes (logical) | `du -sk` | Mongoose graph pkgs / bytes (exclusive) | mongoose resolvable from app / core | Fresh-cache install ms (3 runs) | Warm-cache install ms (3 runs) |
|---|---|---|---|---|---|---|---|---|---|
| A — packed core only | 151 | 151 | 5 | 52,960,060 | 64,112 KiB | 19 / 11,048,410 (17 / 10,998,896) | yes / yes | 6673, 3170, 5273 | 711, 686, 703 |
| B — minimal starter (+ spec, tsx, vitest, typescript) | 199 | 206 | 7 | 137,095,845 | 151,056 KiB | same | yes / yes | 6996, 13077, 8442 | 985, 937, 916 |
| C — production starter | 328 | 337 | 14 | 168,419,061 | 211,736 KiB | same | yes / yes | 10743, 10485, 5064 | 4882, 3615, 3415 |
| D — CLI launcher (core + spec) | 152 | 152 | 5 | 53,009,662 | 64,204 KiB | same | yes / yes | 8684, 4253, 2510 | 700, 735, 744 |

Mongoose graph (identical in every fixture, resolved the way `require` would):
mongoose 8.24.4 (2,631 KB), mongodb 6.20.0 (3,820 KB), bson 6.10.4 (2,775 KB),
kareem, mpath, mquery, sift, @mongodb-js/saslprep 1.5.4, mongodb-connection-string-url,
sparse-bitfield, memory-pager, whatwg-url 14, tr46 5, webidl-conversions 7,
punycode, @types/whatwg-url, @types/webidl-conversions — plus `ms` and `debug`,
which are **shared** with express/send/socket.io/ioredis and stay after
extraction. Exclusive removable graph: **17 packages, 10,998,896 logical bytes**
— 20.8% of fixture A's installed bytes, 8.0% of the minimal starter's. This is
the ceiling S09.5 can claim for core; the production app keeps the graph through
its own module dependencies (R19, R29).

Physical duplicates (all fixtures): `mime-db`, `mime-types`, `negotiator`,
`accepts`, `content-type` (express 5 vs socket.io/engine.io ranges); B/C add
`@types/node` and `undici-types` (two majors via typescript tooling); C adds pm2's
`debug`, `async`, `semver`, `ws`, `ipaddr.js`, `picomatch`, `pino-abstract-transport`.
None involve mongoose: the driver graph is a single physical copy everywhere, so
today's `instanceof Schema` check is safe in installed apps (R23/Q5 concern only
arises once a second package depends on mongoose).

Resolve probe (from the fixture's own `package.json` and from core's entry):
`mongoose`, `mongodb`, `bson`, `@tulipes/core`, `@tulipes/core/db` and
`@tulipes/core/boot` all resolve in A, B, C and D. This is the number that must
flip to "absent from A, B and D" in S09.5. Fixture lockfiles resolve
`@mongodb-js/saslprep` 1.5.4 where the workspace lock pins 1.5.0 — expected for
a fresh install, and why the workspace tree is not evidence.

Installation timing: fresh-cache runs are dominated by registry download and
vary by 2–4× between runs on the same network (retained above, no retries);
warm-cache runs are stable (A ≈ 0.7 s, B ≈ 0.95 s, C ≈ 3.4–4.9 s, D ≈ 0.7 s).
Timing is install, not boot; three runs are recorded, not a statistical claim.

### 4.2 Startup

Fresh process per sample; 1 first run + 3 warm-ups + 20 samples; no sample
removed; zero failures in every scenario. `import_*` scenarios time a dynamic
import inside `node --input-type=module -e` from the fixture root (compiled
`dist/` code, no loader unless stated). Readiness scenarios time from `spawn()`
to the first `200` on every probed path, sample RSS with `ps -o rss=` at that
moment, then send SIGTERM and time until exit (all exits were code 0).

| Fixture | Scenario | n | Median | p95 | Range | RSS at readiness (median) | Shutdown median |
|---|---|---|---|---|---|---|---|
| A — core only | `import_root` (`@tulipes/core`) | 20 | 254 ms | 286 ms | 232–306 ms | — | — |
| A | `import_boot` (`@tulipes/core/boot`) | 20 | 229 ms | 257 ms | 220–271 ms | — | — |
| A | `import_mongoose` (attribution) | 20 | 109 ms | 118 ms | 102–128 ms | — | — |
| B — minimal | `import_root` | 20 | 235 ms | 242 ms | 228–245 ms | — | — |
| B | `import_boot` | 20 | 232 ms | 252 ms | 225–262 ms | — | — |
| B | `import_mongoose` | 20 | 107 ms | 136 ms | 100–156 ms | — | — |
| B | `import_boot_tsx` (through `--import tsx`) | 20 | 335 ms | 343 ms | 329–363 ms | — | — |
| B | `offline_spec` (`tulipes spec --offline`, sockets denied) | 20 | 599 ms | 630 ms | 592–692 ms | — | — |
| B | `backend_readiness` (`tsx app.ts` → `/health` + `/api/v1/hello`) | 20 | 455 ms | 472 ms | 441–474 ms | 146,016 KiB | 6 ms |
| C — production | `import_root` | 20 | 236 ms | 253 ms | 228–289 ms | — | — |
| C | `import_boot` | 20 | 249 ms | 264 ms | 233–361 ms | — | — |
| C | `import_mongoose` | 20 | 106 ms | 117 ms | 103–131 ms | — | — |
| C | `import_boot_tsx` | 20 | 338 ms | 372 ms | 334–375 ms | — | — |
| C | `offline_spec` | 20 | 633 ms | 679 ms | 609–707 ms | — | — |
| C | `backend_readiness` (`tsx app.ts` → `/api/v1/hello`; Mongo + Redis prestarted) | 20 | 566 ms | 611 ms | 554–615 ms | 150,160 KiB | 11 ms |
| C | `worker_readiness` (`tsx worker.ts` → banner "consuming N queue(s)") | 20 | 496 ms | 527 ms | 493–529 ms | 146,912 KiB | 12 ms |

First runs (recorded separately, not in the samples): B backend 478 ms; C
backend **1,352 ms** with RSS 179,472 KiB — first database initialization (index
builds, admin seed, greeting seed) against the fresh `tulipes_s09_*` database;
C worker 559 ms. Steady-state samples reuse that database.

Reading the numbers:

- Importing `@tulipes/core/boot` costs ≈230 ms in a fresh process; importing
  mongoose alone costs ≈107 ms in the same conditions. Because `boot.ts`
  statically imports the database loader (R4), that cost is paid by every
  process today, including the minimal app and offline tooling that never
  connects. The two figures are not additive (shared module graph, V8 warm-up),
  so the removable share is bounded above by ≈100 ms and must be re-measured,
  not subtracted.
- The `tsx` loader adds ≈100 ms to the same import (`import_boot_tsx`); it is
  tooling overhead, reported separately as the plan requires, and unaffected
  by extraction.
- Offline `spec` (≈0.6 s) is dominated by CLI startup, tsx and document
  writing; it never touches the driver at runtime but still loads it through
  core's static import graph when the CLI's bundled boot is imported.
- Production readiness exceeds minimal by ≈110 ms with local services; the
  worker is faster than the backend because it mounts no routes.
- Shutdown with no active work is 6–12 ms; the deadline behavior is covered
  by the integration tests, not by this harness.
- RSS: all three readiness shapes sit at 143–147 MiB; tsx and TypeScript
  compilation are inside the measured process (the generated `start`/`dev`
  scripts run `tsx`), so the figure is the real developer-mode footprint, not
  a compiled-JavaScript one (S12.1 measures that split).

No before/after comparison or percentage improvement is claimed here; the
tables are the baseline S09.10 reruns against.

### 4.3 Reproducibility run (S09.1b)

Repeated on the committed harness at `9aba800` (documentation and harness
commit; core/spec source unchanged, archives byte-identical, clean tree),
fixtures A and B, full sampling policy. Raw data: `reports/s09-inventory/9aba800/`.

| Measurement | First run (`b42bd00`) | Repeat (`9aba800`) | Delta |
|---|---|---|---|
| A installed bytes / unique / copies | 52,960,060 / 151 / 151 | identical | 0 |
| B installed bytes / unique / copies | 137,095,845 / 199 / 206 | identical | 0 |
| Exclusive mongoose graph | 17 / 10,998,896 | identical | 0 |
| A warm install (3 runs) | 711, 686, 703 ms | 722, 666, 641 ms | within noise |
| A `import_boot` median / p95 | 229 / 257 ms | 216 / 225 ms | −6% |
| A `import_mongoose` median | 109 ms | 97 ms | −11% |
| B `import_boot` median / p95 | 232 / 252 ms | 219 / 224 ms | −6% |
| B `import_boot_tsx` median | 335 ms | 325 ms | −3% |
| B `offline_spec` median | 599 ms | 573 ms | −4% |
| B `backend_readiness` median / p95 | 455 / 472 ms | 439 / 464 ms | −4% |

Inventory figures reproduce exactly; timing medians reproduce within 4–11% on
the same host (the first run overlapped a concurrent install of fixtures C/D
and the machine was otherwise idle for the repeat). Comparisons in S09.10 must
therefore treat startup differences under ~10% as noise unless the sample
ranges separate.

### 4.4 After extraction (S09.10)

Same harness, policy, host and local services, on `78bf4eb` (the extraction
plus S09.7/S09.9 tests; runtime source unchanged since `96444f1`). Raw data:
`reports/s09-inventory/78bf4eb/`. "Before" is the `b42bd00` baseline (§4.1–4.2);
the `9aba800` repeat (§4.3) sets the noise floor at roughly ±10% for timings.

Archives: core 352,776 B / 1,120,464 B unpacked / 209 files, **0** `.d.ts`
lines importing mongoose (was 3); spec unchanged in substance; new
`@tulipes/mongoose` 7,370 B / 21,577 B / 15 files (its two `.d.ts` mongoose
imports are the point).

| Fixture | Metric | Before (`b42bd00`) | After (`78bf4eb`) | Change |
|---|---|---|---|---|
| A — core only | unique packages / copies | 151 / 151 | 134 / 134 | −17 / −17 |
| A | installed bytes | 52,960,060 | 41,973,769 | **−10,986,291 (−20.7%)** |
| A | `du -sk` | 64,112 KiB | 51,132 KiB | −20.2% |
| A | mongoose / mongodb / bson resolvable from app, core | yes, yes | **no, no** | absence proven |
| A | warm install (3 runs) | 711, 686, 703 ms | 633, 727, 657 ms | noise |
| A | `import_boot` median / p95 | 229 / 257 ms | **146 / 160 ms** | −36% |
| A | `import_root` median | 254 ms | 157 ms | −38% |
| B — minimal | unique packages / copies | 199 / 206 | 182 / 189 | −17 / −17 |
| B | installed bytes | 137,095,845 | 126,110,245 | **−10,985,600 (−8.0%)** |
| B | mongoose resolvable (app, core) | yes, yes | **no, no** | absence proven |
| B | `import_boot` median | 232 ms | 158 ms | −32% |
| B | `import_boot_tsx` median | 335 ms | 245 ms | −27% |
| B | `offline_spec` median / p95 | 599 / 630 ms | 441 / 548 ms | −26% |
| B | `backend_readiness` median / p95 | 455 / 472 ms | **367 / 390 ms** | −19% |
| B | RSS at readiness (median) | 146,016 KiB | 119,120 KiB | −18% |
| C — production | unique packages / copies | 328 / 337 | 329 / 338 | +1 (`@tulipes/mongoose`) |
| C | installed bytes | 168,419,061 | 168,459,228 | +40,167 (+0.02%) |
| C | mongoose graph | 19 pkgs / 11,048,410 B, 17 exclusive | identical | app-owned, as designed |
| C | `import_boot` median | 249 ms | 158 ms | −37% (the driver now loads in phase 8, not at import) |
| C | `import_mongoose` median | 106 ms | 108 ms | unchanged (attribution) |
| C | `offline_spec` median | 633 ms | 467 ms | −26% |
| C | `backend_readiness` median / p95 | 566 / 611 ms | 617 / 663 ms | +9% — within the noise floor; the driver import moved from process start into phase 8, so readiness pays it either way |
| C | `worker_readiness` median | 496 ms | 549 ms | +11% — same; investigate only if a repeat separates the ranges |
| C | first backend run (index build + seed) | 1,352 ms | 1,390 ms | noise |
| D — launcher (all archives) | unique packages | 152 | 136 | −16 |
| D | installed bytes | 53,009,662 | 42,046,377 | −20.7% |
| D | mongoose resolvable | yes | **no** | the provider archive is installed but declares mongoose only as a peer |

Reading:

- The removable graph measured in §4.1 (17 packages, 10,998,896 B) is exactly
  what disappeared from A, B and D; nothing else moved. Fixture D still
  installs the provider archive and still cannot resolve mongoose, which is the
  peer-dependency design working as intended.
- Every process that never connects — the minimal app, offline `spec`, the
  CLI — stopped paying the driver's import (~100 ms) because `boot.ts` no
  longer imports it statically; import and readiness times dropped by a
  quarter to a third and minimal RSS at readiness by 27 MiB.
- The production app keeps its own Mongoose (its modules declare it) and its
  readiness is unchanged within measurement noise: the same driver is imported
  one phase later. Its offline `spec` and bare import benefit like minimal's.
- No production-preset size claim is made; +40 KB is the provider itself.

Remaining cost recorded for the next adapters (S10/S11): fixture A still
carries `bullmq`, `ioredis`, `socket.io` and `tsx` in core's dependencies
(41.97 MB installed); the harness reports their graphs the same way once the
`mongooseGraph` root is generalized.

### 4.5 After the queues extraction (Sprint 04, S10)

Same harness (now attributing every extracted driver's graph), policy and host
on `3cec33c` (the S10 extraction plus tests; runtime source unchanged since
`b6c893c`). Raw data: `reports/s09-inventory/3cec33c/`. "Before" is the S09
after-state (`78bf4eb`, §4.4).

| Fixture | Metric | Before S10 (`78bf4eb`) | After S10 (`3cec33c`) | Change |
|---|---|---|---|---|
| A — core only | unique packages | 134 | 117 | −17 |
| A | installed bytes | 41,973,769 | 31,900,402 | **−10,073,367 (−24.0%)**; cumulative since S09 baseline −39.8% |
| A | `bullmq` / `ioredis` graphs | 16 pkgs / 10,099,358 B; 9 / 1,057,038 B | absent | removed |
| A | `socket.io` graph (S11 target) | 22 / 5,044,748 (16 exclusive / 4,928,038) | unchanged | the next removable cost |
| A | `import_boot` median / p95 | 146 / 160 ms | **89 / 92 ms** | −39% |
| B — minimal | unique packages / bytes | 182 / 126,110,245 | 166 / 116,063,812 | −16 / −8.0% |
| B | `bullmq`, `ioredis`, `@tulipes/bullmq` resolvable | yes | **no** (app, core, launcher) | absence proven |
| B | `import_boot` / `import_boot_tsx` | 158 / 245 ms | 90 / 125 ms | −43% / −49% |
| B | `offline_spec` median | 441 ms | 285 ms | −35% |
| B | `backend_readiness` median / p95 | 367 / 390 ms | **247 / 248 ms** | −33% |
| B | RSS at readiness (median) | 119,120 KiB | 95,536 KiB | −20% (cumulative −35% since S09 baseline) |
| C — production | unique packages / bytes | 329 / 168,459,228 | 330 / 168,479,614 | +1 (`@tulipes/bullmq`), +20 KB |
| C | `bullmq` / `ioredis` graphs | 16 / 10.1 MB; 9 / 1.06 MB | identical; ioredis now shared by the provider **and** the app's own cache/limiter (6 exclusive pkgs, 149 KB) | app-owned, as designed |
| C | `import_boot` median | 158 ms | 90 ms | −43% (drivers load in phase 8) |
| C | `offline_spec` median | 467 ms | 304 ms | −35% |
| C | `backend_readiness` / `worker_readiness` | 617 / 549 ms | 565 / 497 ms | −8% / −9%, within noise |
| D — launcher (all archives) | unique packages / bytes | 136 / 42,046,377 | 137 / 42,066,677 | +1: the provider archive **does** carry bullmq/ioredis as dependencies, so a launcher that installs every archive resolves them — which is exactly why the smoke launcher installs core only |

Fresh-cache install timings in this run were dominated by an unusually slow
registry (A: 20.6 / 5.9 / 7.4 s) and are retained but not compared; warm
installs are stable (A ≈ 0.5 s, B ≈ 0.85 s).

Reading: BullMQ's graph is heavy (10.1 MB, larger than Mongoose's exclusive
share) and its import was on every process's path; removing it took a third
off minimal readiness and offline `spec` on top of S09's gains. What remains
in fixture A is `socket.io` (4.9 MB exclusive), `tsx`, `express`, `i18next`
and `zod`.

### 4.6 After the sockets extraction (Sprint 04, S11)

Fixtures A and B on `5bba0b3`, same harness and host. Raw data:
`reports/s09-inventory/5bba0b3/`. Production is unaffected by construction
(it keeps every provider) and was not re-measured.

| Fixture | Metric | After S10 (`3cec33c`) | After S11 (`5bba0b3`) | Change | Since S09 baseline (`b42bd00`) |
|---|---|---|---|---|---|
| A — core only | unique packages | 117 | **99** | −18 | 151 → 99 (−34%) |
| A | installed bytes | 31,900,402 | **26,950,827** | −4,949,575 (−15.5%) | 52,960,060 → 26,950,827 (**−49.1%**) |
| A | duplicated names | 5 | 1 | the express-5 vs socket.io duplicates (`mime-*`, `negotiator`, `accepts`) are gone | |
| A | every extracted driver resolvable | socket.io only | **none** | | |
| A | `import_boot` median | 89 ms | **75 ms** | −16% | 229 → 75 ms (−67%) |
| B — minimal | unique packages / bytes | 166 / 116,063,812 | 150 / 106,157,244 | −16 / −8.5% | 137,095,845 → 106,157,244 (−22.6%) |
| B | `import_boot` / `import_boot_tsx` | 90 / 125 ms | 74 / 101 ms | −18% / −19% | 232 / 335 → 74 / 101 ms |
| B | `offline_spec` median | 285 ms | 273 ms | noise | 599 → 273 ms (−54%) |
| B | `backend_readiness` median / p95 | 247 / 248 ms | 232 / 264 ms | within noise | 455 → 232 ms (−49%) |
| B | RSS at readiness | 95,536 KiB | 96,256 KiB | noise | 146,016 → 96,256 KiB (−34%) |

Core's remaining runtime dependencies: `colorette`, `dotenv`, `express`,
`i18next`, `i18next-fs-backend`, `tsx`, `zod`. The next measurable step is
S12 (whether `tsx` and the CLI belong in the runtime package at all).

## 5. Affected-file extraction checklist

Grouped by downstream task; each item references a register row. Items for
S09.2, S09.3, S09.4, S09.5, S09.6 and S09.8 were executed on 2026-09-11 (see
the [provider design §9](mongoose-provider-design.md#9-executable-fixtures-for-s092b)).

- **S09.2 (design):** R7/R8 access contract; R3/R9 status type; R12/R13 requirement declaration; R15 runtime selection; R26 new-module policy; R30 explicit selection; §3.3 bootstrap-only gap — all decided in [the provider design §1](mongoose-provider-design.md#1-decision-summary).
- **S09.3 (metadata):** R18 — document "model metadata unsupported"; no code.
- **S09.4 (runtime move):** `src/db/database.ts`, `src/db/model-store.ts`, `src/db/index.ts`, phase-8 call site and shutdown disposer in `src/boot/boot.ts`, banner status (R4, R5, R9, R10, R11); tests R36.
- **S09.5 (dependency removal):** `packages/core/package.json` dependency + `./db` export (R1, R2); `boot.ts` type import (R3); `contracts.ts` type import (R7); `app-core.ts` comment (R16); packed `.d.ts` verification.
- **S09.6 (consumers):** generator lines R19–R24, R26, R27; example files R29–R35; templates/skills parity.
- **S09.7 (compatibility):** `@tulipes/core/db`, `DatabaseCtx`, `requireModels`, `ctx.models`, `BootHandle.connection`, README/MIGRATING/CHANGELOG (R2, R28).
- **S09.8 (artifacts/CI):** `scripts/artifacts.mjs`, `scripts/scaffold-smoke.mjs`, `verify.yml` (R38–R40).
- **S09.9 (failure matrix):** §3.1 rows as tests; R36, R37.
- **S09.10 (compare):** rerun `scripts/s09-inventory.mjs` on the post-extraction source; compare §4 tables.

## 6. Reproduction

```sh
# from the repository root, clean tree
node scripts/s09-inventory.mjs baseline          # identity, fresh archives, search register
node scripts/s09-inventory.mjs install A B C D   # ~3 min; isolated caches under $TMPDIR
TEST_MONGO_URI=mongodb://127.0.0.1:27017/tulipes_s09 TEST_REDIS_URL=redis://127.0.0.1:6379/3 \
  node scripts/s09-inventory.mjs startup A B C   # C is "not measured" without both variables
node scripts/s09-inventory.mjs summary           # reports/s09-inventory/<sha>/summary.md
node scripts/s09-inventory.mjs clean             # removes the temp fixtures
```

`S09_SAMPLES`, `S09_WARMUPS` and `S09_INSTALL_RUNS` override the policy for
smoke runs; a reduced run must be labelled incomplete in the report.

## 7. Open questions carried to S09.2

| # | Question | Register rows | Decision entry |
|---|---|---|---|
| Q1 | Where does the app select the provider — boot option or static declaration readable by `sync`/offline tooling? | R15, R17, R30 | §5.2 |
| Q2 | Is a `models/` directory the module's requirement declaration, or does the manifest need a static key (and what does a model-consuming module without model files declare)? | R12, R13, R24 | §5.3 |
| Q3 | Replacement for `ctx.models` / `DatabaseCtx` / `requireModels` that keeps `get<T>(name)` ergonomics without leaking `Model` through core | R7, R8, R11 | §5.5 |
| Q4 | Status surface for the banner and `BootHandle.connection` | R3, R9 | §5.5 |
| Q5 | How the provider guarantees the app's global plugin registration hits the same mongoose instance (peer dependency vs bundled) | R23, R31 | §5.6 |
| Q6 | `tulipes new module` in a provider-free app | R26 | §5.6 |
| Q7 | Bootstrap-only module without a URI: keep silent skip, warn, or refuse? | §3.3 | §5.3 |
| Q8 | Bridge vs breaking prerelease for `@tulipes/core/db` | R2, R28 | §5.6 compatibility |

## 8. Backlog noted while inventorying

- **S09.1-doc:** `model-store.ts` comment promises `tulipes sync` typed accessors; `sync` emits none (R11, R17).
- **S09.2-plugin:** `register.ts` guard is per module instance, not per mongoose instance; two-boot and two-install tests required (R23).
- **S09.8-isolation:** smoke launcher installs every archive (R39).
- **New:** `presets.test.ts` and the minimal smoke assert `ctx.models === undefined` — a runtime-absence check that does not prove installation absence; S09.5 needs the resolve probe as well.
- **New:** bootstrap-only module without `MONGO_URI` is silently skipped (§3.3).
