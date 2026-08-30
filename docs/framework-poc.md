# Tulipes — Proof of Concept

> **Working name:** `tulipes` / npm scope `@tulipes`. Placeholder — rename is a find-and-replace away.
>
> **Goal:** a 2026 Express framework that makes it fast to set up and run a safe, production-grade API without rewriting boilerplate. Convention-driven, module-based, fail-closed.
>
> **Status:** design POC. Donor prototype: `bp-backend-express` (this repo). The framework itself gets a fresh repo.

---

## 1. The split

The project divides into exactly two things:

| Part | What it is | Who touches it |
|---|---|---|
| **`@tulipes/core`** | One published (private npm) package holding all engines: Environment, module explorer, config builder, model store, queue manager, socket manager, ACL engine, express wiring, error handler, responder, request logger, i18n runtime, http server, graceful shutdown, CLI. Subpath exports: `@tulipes/core/acl`, `@tulipes/core/env`, … | Framework author. End developer imports it, never edits it. |
| **App skeleton** | The folder structure the end developer sees, owns, and runs. Modules, app-owned glue (`lib/`), env files, locale files, two ~5-line entrypoints. | End developer. |

Deliberately **excluded from core**, staying app-side in `lib/`: the cache helpers and mongoose helpers (thin, app-flavored, developers will want to edit them).

---

## 2. App skeleton (what the end developer sees)

```
my-api/
├── modules/                  # all business modules — yarn workspaces
│   ├── core/                 # tier: sys — infra vars, base middleware, role definitions
│   ├── auth/
│   ├── users/
│   └── categories/
├── lib/                      # app-owned glue (NOT core)
│   ├── cache.ts              # cache helpers
│   └── mongoose.ts           # mongoose helpers (plugins, base schema opts)
├── config/
│   └── app.config.ts         # global non-module config overrides
├── locales/                  # i18n dictionaries (runtime lives in core)
│   ├── en.json
│   └── fr.json
├── types/
│   └── config.d.ts           # GENERATED — `tulipes sync`, do not edit
├── .envs/
│   ├── .env.development
│   ├── .env.staging
│   └── .env.production
├── .env.example              # GENERATED from all meta.variables.json
├── app.ts                    # import { boot } from '@tulipes/core'; boot({ mode: 'backend' })
├── worker.ts                 # boot({ mode: 'worker' })
├── package.json              # "workspaces": ["modules/*"]
└── tsconfig.json
```

Entrypoints are intentionally trivial:

```ts
// app.ts
import { boot } from "@tulipes/core";

boot({ mode: "backend" }); // or read PROCESS_MODE, see §8
```

---

## 3. Module anatomy

Every module is a **yarn workspace package** under `./modules/*`. Folder names stay clean (no prefixes); ordering metadata lives in `package.json` (§5).

```
modules/users/
├── bootstrap/                # post-DB, pre-server init tasks
│   └── seed-admin.bootstrap.ts
├── routes/
│   └── users.routes.ts
├── models/
│   └── user.model.ts
├── controllers/              # convention only — NOT globbed by core
│   └── users.controllers.ts
├── sockets/                  # optional
│   └── users.sockets.ts
├── queues/                   # optional
│   └── users.queues.ts
├── helpers/                  # optional, module-private
├── module.acl.ts
├── module.config.ts
├── meta.variables.json
└── package.json
```

`package.json`:

```json
{
  "name": "@app/users",
  "version": "0.0.0",
  "tulipes": {
    "tier": "app",
    "priority": 10,
    "dependsOn": ["auth"]
  },
  "dependencies": {
    "@app/auth": "workspace:*"
  }
}
```

Rules:

- **Canonical module name** = `package.json` `name` (short form: last path segment, e.g. `users`). `dependsOn` references these names.
- **Cross-module imports go through the package name** (`import { User } from '@app/users'`), never relative paths. The package manager then *enforces* declared dependencies: importing an undeclared module fails resolution. That is the "each module can run alone" guarantee, checked mechanically.
- `controllers/` is pure convention. Routes import their controllers directly by name; core gains nothing by globbing them.
- `sockets/` and `queues/` are optional; absence is silently fine.

---

## 4. `meta.variables.json`

Each module declares every env variable it needs. Plain JSON — deliberately not TS — so tooling (CLI codegen, `.env.example` generation, docs, the postman generator) can read it **without executing code**.

```json
{
  "$schema": "https://tulipes.dev/schemas/meta.variables.json",
  "variables": [
    {
      "name": "USERS_MAX_SESSIONS",
      "type": "number",
      "description": "Max concurrent sessions per user",
      "default": 5
    },
    {
      "name": "USERS_SIGNUP_MODE",
      "type": "enum",
      "enum": ["open", "invite", "closed"],
      "description": "Who can register",
      "default": "open"
    },
    {
      "name": "USERS_ADMIN_EMAIL",
      "type": "string",
      "required": true,
      "description": "Seeded admin account email"
    }
  ]
}
```

Field contract:

| Field | Notes |
|---|---|
| `name` | UPPER_SNAKE. **One owner per variable across the whole app** — a name declared by two modules is a boot crash naming both modules. Shared infra vars (`MONGO_URI`, `REDIS_URL`, `PORT`, `APP_ENV`…) are declared once, in the sys `core` module; every other module just reads the store. |
| `type` | `string` \| `number` \| `boolean` \| `enum` \| `url` \| `secret` (secret = redacted in logs/reports) |
| `enum` | required when `type: "enum"` |
| `required` | if `true` and no value resolves → boot crash |
| `group` | optional free-form label tying related variables together (e.g. `MONGO_URI`, `MONGO_USERNAME`, `MONGO_PASSWORD` all under `database`); drives section grouping in generated `.env.example` and docs |
| `default` | used when `.env` and `process.env` are silent; forbidden together with `required: true` |
| `description` | feeds `.env.example` comments and docs |

Core validates every entry with Zod internally (types, enum membership, url shape). **Fail closed**: all violations are collected and reported in a single boot-crash report — every missing/invalid variable at once, never one-by-one.

---

## 5. Module ordering

Three sort keys, applied in order:

1. **Tier**: `sys` before `app`. (Two tiers only.)
2. **Priority**: numeric, lower loads earlier, default `100`. Tie-breaker within a tier.
3. **Topological sort** on `dependsOn` within the resulting order.

Crashes (boot-time, with a readable report):

- Dependency **cycle** → crash, cycle printed.
- **Backwards cross-tier dep** — a `sys` module depending on an `app` module → crash.
- `dependsOn` naming a module that doesn't exist → crash.

Because ordering metadata lives in `package.json` and not the folder name, reprioritizing a module never breaks `dependsOn` references.

---

## 6. Environment engine

The first thing that runs. Contract:

- Mode comes from **`APP_ENV`** (`development` | `staging` | `production`) — dedicated, *not* `NODE_ENV`, which bundlers and libraries abuse for optimization flags. Core sets `NODE_ENV` to a sane mirror for third-party libs.
- Loads `.envs/.env.<APP_ENV>`.
- Globs `./modules/*/meta.variables.json`, builds the **variable store**.
- Resolution precedence per variable: **`process.env` (shell/container) > `.env.<APP_ENV>` file > `default` in meta**. Container-injected vars must always win.
- Validates everything (§4), crashes with the aggregate report if anything is missing/invalid.
- Exposes a typed store: `Environment.get('USERS_MAX_SESSIONS')` (typed via codegen, §10), `Environment.set(...)` for tests.

---

## 7. Loader contracts (`@tulipes/core` — the actual TypeScript)

These signatures are the heart of the framework. Everything else is glue around them.

```ts
// ── shared context ──────────────────────────────────────────────
export interface Ctx {
  app: Express;                 // absent in worker mode phases that don't need it
  Environment: EnvironmentEngine;
  config: GlobalConfig;         // augmented by codegen, §10
}

// ── module.config.ts ────────────────────────────────────────────
// default-export. Builds module config, injects into global config.
// May also export lifecycle hooks.
export type ModuleConfigFn = (ctx: Ctx) => ModuleConfig | Promise<ModuleConfig>;

export interface ModuleLifecycle {
  onReady?: (ctx: Ctx) => Promise<void>;     // after server is listening
  onShutdown?: (ctx: Ctx) => Promise<void>;  // graceful shutdown, reverse load order
}

// ── *.routes.ts ─────────────────────────────────────────────────
export type RoutesFn = (ctx: Ctx) => Router | Promise<Router>;

// ── *.model.ts ──────────────────────────────────────────────────
// Pure definitions — no function export. Loaded into the global
// model store keyed by model name. Mongoose-only in v1 (§12).
export type ModelDef = { name: string; schema: Schema; };

// ── bootstrap/*.bootstrap.ts ────────────────────────────────────
// Post-DB, pre-server init: ensure indexes, seed roles, default admin…
export type BootstrapFn = (ctx: Ctx & { models: ModelStore }) => Promise<void>;

// ── *.queues.ts ─────────────────────────────────────────────────
export type QueuesFn = (ctx: Ctx, queueManager: QueueManager) => void | Promise<void>;

// ── *.sockets.ts ────────────────────────────────────────────────
export type SocketsFn = (ctx: Ctx, socketManager: SocketManager) => void | Promise<void>;

// ── module.acl.ts ───────────────────────────────────────────────
export type AclFn = (acl: AclBuilder) => void;
```

**Discovery strategy (dev vs prod):** core globs module files at boot. In dev, the app runs under `tsx` and core globs `*.ts`; in prod, the app is compiled and core globs `*.js` in `dist/`. Core picks the extension by detecting whether it is running compiled — the "drop a folder in, it works" behavior survives both.

---

## 8. Boot pipeline

Single pipeline, **mode fork at phase 9** on `PROCESS_MODE` (`backend` | `worker`; `cron` reserved for later).

| # | Phase | Detail |
|---|---|---|
| 1 | **Environment engine starts** | read `APP_ENV`, load `.envs/.env.<APP_ENV>` |
| 2 | **Meta discovery** | glob `modules/*/meta.variables.json`, build variable store |
| 3 | **Resolve & validate** | precedence `process.env` > file > default; Zod-validate; **crash with aggregate report** on any miss |
| 4 | **Module graph** | read every module `package.json` → tier, priority, `dependsOn`; sort (§5); crash on cycle / backwards dep / unknown dep |
| 5 | **Explore modules** | glob paths for `module.config.ts`, `module.acl.ts`, `routes/*.routes`, `models/*.model`, `bootstrap/*.bootstrap`, `queues/*.queues`, `sockets/*.sockets` — in load order |
| 6 | **Build global config** | seed from `config/app.config.ts`, then call each `ModuleConfigFn(ctx)` in load order, merging returns; collect lifecycle hooks |
| 7 | **ACL merge** | run each `module.acl.ts` against the AclBuilder (§9); crash on conflicts |
| 8 | **Database + models + bootstrap** | connect Mongoose → load all `ModelDef`s into the global model store → run every `BootstrapFn` in load order (indexes, seeds) |
| 9 | **── MODE FORK ──** | `PROCESS_MODE` decides the tail of the pipeline |
| 9b | *backend:* **Queues (producers)** | init queue manager, register queues (no processors) |
| 10b | *backend:* **Express + routes** | create app, mount every `RoutesFn` router in load order — a sys-tier security module supplies the head of the pipeline (headers, request logger, body parsing); core itself mounts only the fail-closed tail (404 + error handler) |
| 11b | *backend:* **HTTP + sockets + listen** | create http server, init socket manager, run `SocketsFn`s, `listen()` |
| 9k | *worker:* **Queues (processors)** | init queue manager **with processors**, run `QueuesFn`s, start consuming |
| 12 | **onReady** | fire all `onReady` hooks in load order |
| — | **Shutdown** (SIGTERM/SIGINT) | fire `onShutdown` hooks in **reverse** load order → close sockets → drain queues → close http → disconnect DB/Redis → exit |

---

## 9. ACL merge semantics

- **Roles are global.** Declared in the sys `core` module.
- Other modules **attach permissions** to existing roles, scoped to their own resources: `acl.allow('admin', 'users:write')`.
- Resource names are **namespaced by module** (`users:*`, `categories:*`).
- A module may introduce a new role only explicitly: `acl.defineRole('moderator')`.
- Two modules granting the same `role + resource` → **boot crash**. Since resources are module-namespaced, a collision always means a duplicated resource name — always a bug.

---

## 10. Typed config & codegen

Chosen approach: **codegen a `config.d.ts`** (over module augmentation), produced by the CLI:

- `tulipes sync` reads every module's exported config shape + every `meta.variables.json` and emits:
  - `types/config.d.ts` — augments `GlobalConfig` and types `Environment.get()` keys/returns
  - `.env.example` — every variable with description comments, grouped by module
  - postman collection (feeds the existing postman-generator)
- `tulipes dev` runs sync automatically in watch mode, so generated types never go stale.
- Generated files are committed, marked `do not edit`.

---

## 11. CLI (`tulipes`)

Ships inside `@tulipes/core` (bin entry).

| Command | Does |
|---|---|
| `tulipes dev` | boot under tsx, watch mode, auto-`sync` on meta/config change |
| `tulipes build` | compile to `dist/`, run `sync`, verify boot phases 1–7 dry-run |
| `tulipes new module <name>` | scaffold full module skeleton (§3) with workspace wiring |
| `tulipes sync` | regenerate `config.d.ts`, `.env.example`, postman collection |
| `tulipes env:check` | phases 1–3 only — validate current `.env` against all meta files, print the report, exit. CI-friendly. |

---

## 12. Committed stack (v1)

Opinionated, wired by core, non-negotiable in v1:

- **Mongoose / MongoDB** — models, store
- **BullMQ** — queues
- **ioredis** — cache, rate-limiting, queue backend
- **Socket.IO** — sockets
- **JWT-only auth** — the `auth` module is the reference module
- **Zod** — internal validation (env, config)

**v2 directions (explicitly out of scope now):** DB-agnostic model store behind adapters (drizzle/prisma), `cron` process mode, request-lifecycle diagram (request → core middleware → auth → ACL → controller → responder/error-handler — stub for a future eraser prompt), public npm release.

---

## 13. Eraser.io prompt — boot workflow diagram

Paste the block below into eraser.io **DiagramGPT** with diagram type **Flow chart**.

```text
Create a flow chart of the boot pipeline of "Tulipes", a module-based Express framework.
Use one subgraph (group) per phase, connected top to bottom. Use a decision node for the mode fork.

Group "Phase 1-3: Environment Engine":
"Read APP_ENV" -> "Load .envs/.env.<APP_ENV>" -> "Glob modules/*/meta.variables.json" -> "Build variable store" -> "Resolve values (process.env > .env file > default)" -> decision "All required vars valid?".
"All required vars valid?" No -> terminal node "CRASH: aggregate report of every missing/invalid variable" (red).
"All required vars valid?" Yes -> next group.

Group "Phase 4-5: Module Graph & Discovery":
"Read each module package.json (tier, priority, dependsOn)" -> "Sort: tier (sys first) > priority > topological sort" -> decision "Graph valid?".
"Graph valid?" No -> terminal node "CRASH: cycle / backwards sys->app dep / unknown module" (red).
"Graph valid?" Yes -> "Glob module files in load order: module.config.ts, module.acl.ts, routes, models, bootstrap, queues, sockets".

Group "Phase 6-7: Config & ACL":
"Seed global config from config/app.config.ts" -> "Call each module.config.ts fn(ctx) in load order, merge into global config, collect onReady/onShutdown hooks" -> "Run each module.acl.ts against AclBuilder (roles global, resources module-namespaced)" -> decision "ACL conflict?" .
"ACL conflict?" Yes -> terminal node "CRASH: duplicate role+resource grant" (red).
"ACL conflict?" No -> next group.

Group "Phase 8: Database":
"Connect Mongoose" -> "Load all *.model.ts into global model store" -> "Run bootstrap/*.bootstrap.ts in load order (ensure indexes, seed roles, default admin)".

Decision node "PROCESS_MODE?" with two branches: "backend" and "worker".

Group "Backend branch (phases 9b-11b)" (from "backend"):
"Init queue manager (producers only)" -> "Create Express app" -> "Mount core middleware: security headers, request logger, i18n, parsers" -> "Mount every *.routes.ts router in load order" -> "Mount error handler + responder last" -> "Create HTTP server" -> "Init socket manager, run *.sockets.ts" -> "listen()".

Group "Worker branch (phase 9k)" (from "worker"):
"Init queue manager WITH processors" -> "Run *.queues.ts in load order" -> "Start consuming jobs".

Both branches -> "Fire onReady hooks in load order" -> terminal node "RUNNING" (green).

Separate small group "Graceful shutdown (SIGTERM/SIGINT)":
"Fire onShutdown hooks in REVERSE load order" -> "Close sockets" -> "Drain queues" -> "Close HTTP server" -> "Disconnect Mongo + Redis" -> terminal node "EXIT 0".
Connect "RUNNING" to this group with a dashed arrow labeled "SIGTERM / SIGINT".

Style: crash nodes red, RUNNING green, decision nodes as diamonds, keep left-to-right compactness inside groups.
```

---

*POC by design session, 2026-08-29. Donor repo: `bp-backend-express`, branch `feat/refactore`.*
