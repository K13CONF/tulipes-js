# Migrating

Every `0.x` minor from `0.2` to `0.5` carried breaking changes. They are
listed here newest-first, but an upgrade should be read **oldest-first**
from wherever you are: the steps compose, and the data migration in 0.5 is
the only one that can lock users out of an application.

Run `tulipes update` to move the global CLI and every module manifest at
once; it reinstalls the CLI into the prefix it already lives in, which is
what makes it work under nvm.

---

## 0.12 — every RAI id has a scope

A RAI id was `module:resource`. It is now `module:scope:resource[:extra]`,
where the scope is the surface the endpoint serves: `bo` for a back
office, `web` for a signed-in client, `mobile`, whatever the app names. An
app on 0.11 refuses to boot on 0.12 until its ids are rewritten:

```
✖ [users] GET /users: rai id "users:read" is invalid — expected
  "module:scope:resource" or "module:scope:resource:extra", lowercase segments ([a-z][a-z0-9-]*)
```

From the app root, with the 0.12 CLI:

```sh
tulipes migrate 0.12            # every id lands in scope "web"; --scope picks another
pnpm typecheck && pnpm test
```

It rewrites three things and reports each file:

- every `id: "a:b"` inside `rai({ … })` in `routes/` (any depth) and in
  `agent/`, to `a:web:b`;
- every two-segment grant inside `allow(…)` in `module.acl.ts`;
  `"a:*"` and `"*"` are already valid and stay;
- every other string literal in the app's TypeScript that is exactly one
  of those ids: an access check written by hand, an assertion in a test.

An id built at runtime is listed as a TODO in the report, and so is an
id whose segment starts with a digit, which cannot take a scope as is. The mapping
is written to `config/migration-0.12.json`; delete it once reviewed.

**By hand: put each surface in its scope.** Everything lands in one scope.
Move the back-office ids to `bo` (or your own name): the id in `routes/`,
its grants in `module.acl.ts`, and its references. The reference app's
split, for comparison:

| 0.11 | 0.12 |
|---|---|
| `auth:login`, `auth:me`, … | `auth:web:login`, `auth:web:me`, … |
| `auth:session-end` | `auth:web:sessions:end` |
| `users:read`, `users:ping`, `users:demo-missing` | `users:web:list`, `users:web:ping`, `users:web:demo:missing` |
| `users:create`, `users:delete`, `users:read-deleted` | `users:bo:create`, `users:bo:delete`, `users:bo:list:deleted` |
| `hello:greet`, `hello:greet-name`, `hello:read` | `hello:web:greet`, `hello:web:greet:by-name`, `hello:web:secret` |
| `hello:list-greetings`, `hello:use-greeting`, `hello:reset-counts` | `hello:web:greetings`, `hello:web:greetings:use`, `hello:bo:greetings:reset` |
| `config:read`, `config:describe`, `config:write` | `config:bo:read`, `config:bo:describe`, `config:bo:write` |
| `settings:logs` | `settings:bo:logs` |
| `agent:tools`, `agent:invoke` | `agent:web:tools`, `agent:web:invoke` |

A prefix grant now reaches every depth, which can shorten a grant list:
`allow("user", "auth:web:sessions:*")` covers `auth:web:sessions` and
`auth:web:sessions:end`.

**Optional, recommended.**

- Give roles a description, read back by `tulipes roles`, the console and
  the OpenAPI document: `defineRole("admin", { description: "Runs the back office" })`.
- Name routes and controllers scope-first: `routes/web.users.routes.ts`,
  `routes/bo.users.routes.ts`, a folder per scope when one scope has
  several files (`routes/web/hello.greetings.routes.ts`). Core reads every
  `*.routes.ts` under `routes/` at any depth, so nothing breaks if you
  keep the old names.
- Tooling that parsed ids itself should call `parseRai()`, and anything
  that resolved roles from `acl.describe()` should call `acl.rolesFor()`:
  the old "namespace before the first colon" rule no longer covers
  `users:bo:*`.

---

## 0.11.0 — from a candidate (rc.1 or rc.2)

Install the 0.11.0 CLI first (`npm install -g @tulipes/cli`), then in the
app `pnpm update -r "@tulipes/*"` — the candidate CLIs' `tulipes update`
downgrades a candidate app, the stable one does not. Then
`tulipes migrate 0.11` again: on a candidate app it only rewrites the agent
surface, which is actions only since the candidates — `tools:` becomes
`actions:`, every `{ route: … }` entry and every `agent: false` on a
`rai()` is deleted, and nothing else changes. For each route an agent
should still be able to call, declare an action with a handler; the
reference `hello` module shows the pattern (the query moves to `helpers/`,
the route and the action both call it). The manifest's tools have no
`transport` field; the `agent` door and `@tulipes/mcp` call every tool at
`POST <prefix>/agent/tools/<name>`.

---

<a id="unreleased--module-layout-and-plain-routes"></a>

## 0.11.0 — the two commands

Most of the 0.11 sections below are what `tulipes migrate 0.11` does by
itself on an app generated on 0.10, leaving a `TODO 0.11:` comment and a
line in its report wherever it cannot decide. The order:

```sh
corepack enable                 # pnpm 10 is pinned by the migrated manifest
tulipes migrate 0.11            # from the app root, with the 0.11 CLI
pnpm install
tulipes config:import --env production   # once per environment, from its .envs file
pnpm sync && pnpm typecheck     # the TODOs are where this may still fail
```

Then review `config/migration-0.11.json` and delete it, declare
`"settings": "@tulipes/mongoose/settings"` if the app should keep its
settings in MongoDB, and delete from `.envs/` the variables the record
names. The sections below say what each rewrite is and what to do by hand
where the command stopped.

## 0.11.0 — production without tsx

Node 24 (and 22.18+) runs TypeScript as it is, so nothing transpiles any
more. `tulipes migrate 0.11` (0.11-S06.3) performs the mechanical part;
by hand:

1. In `tsconfig.json`, next to `moduleResolution`, add
   `"allowImportingTsExtensions": true`, `"rewriteRelativeImportExtensions": true`
   and `"erasableSyntaxOnly": true`.
2. Rewrite every relative import of your own files from `.js` to `.ts`
   (`from "../controllers/x.controllers.js"` → `.ts`); package imports do
   not change.
3. Replace what native stripping refuses and `erasableSyntaxOnly` now
   reports: parameter properties (`constructor(private readonly ctx: Ctx) {}`
   becomes a declared field assigned in the constructor), `enum`, and
   runtime `namespace`s.
4. In `package.json`: `"start": "node app.ts"`, `"worker": "node worker.ts"`,
   `"script": "node"`; remove `tsx` from `devDependencies` and `esbuild`
   from `pnpm.onlyBuiltDependencies`. In `ecosystem.config.cjs` set
   `interpreter: "node"`. In `vitest.config.ts` drop
   `execArgv: ["--import", "tsx"]`.
5. `pnpm install`, then `pnpm sync`: the generated types now use `.ts`
   specifiers.

## 0.11.0 — the reference app: environment, console, auth cache

Generated apps are the user's code, so these are steps, not library changes.

1. **Environment.** Remove from `modules/security/package.json` every
   `tulipes.env` entry (`BODY_LIMIT`, `TRUST_PROXY_CIDRS`, `CORS_*`,
   `HSTS_MAX_AGE`, `RATE_LIMIT_*`, `AUTH_RATE_LIMIT`,
   `AUTH_SESSION_RATE_LIMIT`, `SETTINGS_RATE_LIMIT`) and from the core
   module `PUBLIC_DOMAIN`, `LOG_BASENAME`, `LOG_ERROR_BASENAME` and the
   rotation and retention variables. Copy the reference app's
   `modules/security/module.config.ts`, `helpers/hardening.ts`,
   `helpers/rate-limit.ts`, `routes/security.routes.ts` and
   `modules/core/module.config.ts`, and the `LOG_FILES` constants in
   `helpers/logger/`. Values from your `.envs` files become settings:
   write them once through `PATCH /config/security` and `PATCH /config/core`
   (or `tulipes config:import`, 0.11-S06.4), then delete the lines.
2. **The console.** Copy `modules/config/` from the reference app and grant
   `config:read` and `config:describe` to `admin`, `config:*` to
   `sysadmin`. Reduce `modules/settings/` to `routes/`,
   `controllers/settings.controllers.ts` (the log stream only),
   `helpers/log-stream.ts`, `helpers/log-tail.ts`, `helpers/access-lease.ts`,
   `schemas/` (`logQuery`) and its ACL; delete `helpers/audit.ts`,
   `env-file.ts`, `files.ts`, `pm2.ts` and the `AuditEvent` model. Clients of
   `GET /settings/modules` read `GET /config`; of the variable and
   translation editors and the reboot endpoint, nothing — see the
   `tulipes-settings` skill for where each went.
3. **The auth cache.** Copy `modules/auth/helpers/session-cache.ts`, the
   `cacheTtlSeconds` setting, and the changes in `helpers/passport.ts`,
   `helpers/tokens.ts`, `helpers/passwords.ts` and `lib/index.ts`. Any code
   of yours that writes a user's role or deletes a user calls
   `forgetUser(ctx, userId)` from `@app/auth` first.
4. Harnesses and tests that set the retired variables write the settings
   instead, after boot: `ctx.settings.set("security", { … }, actor)`.

## 0.11.0 — settings in the database

An app that keeps settings in `config/settings.<APP_ENV>.json` changes
nothing. To move them into MongoDB, as the production preset now does:

1. Add the provider to the root `package.json`:
   `"tulipes": { "providers": { "settings": "@tulipes/mongoose/settings" } }`
   (next to `models`; the store shares that connection).
2. Boot once: every namespace is seeded from its schema's defaults. Values
   edited in the JSON file are not carried over — set them again through
   `ctx.settings.set()` or `tulipes config:import` (0.11-S06.4), then delete
   the file.
3. Deployments with replicas now see a write everywhere: on a replica set
   through a change stream, otherwise within the 2s poll.

## 0.11.0 — the agent surface

Nothing is required: a module with no `agent/` file offers agents nothing,
and `ctx.agent` is built in every process. To offer something:

1. Add `agent/<module>.agent.ts` with `defineAgent({ summary, actions })` —
   an action has an id (its permission), a description written for a model,
   an optional zod `input` and a handler; see the `tulipes-agent-tool`
   skill. `tulipes agent manifest --role user` shows what a role would see.
2. For agents outside the process, add the `agent` module `tulipes init`
   scaffolds — copy `modules/agent/` from the reference app (routes, ACL,
   i18n) and grant `agent:*` to the roles that may discover and run tools.
4. For Claude Code: `pnpm add -D @tulipes/mcp` and
   `claude mcp add <app> -- pnpm tulipes-mcp --token <bearer token>`.

## 0.11.0 — generated model and job types

`tulipes sync` writes `types/tulipes.d.ts` and deletes the `types/config.d.ts`
it wrote before. Nothing else is required; two steps are worth taking.

1. In each `queues/*.queues.ts`, declare the job data once and drop the
   `define()` call for queues that need no options:

   ```ts
   import type { JobSchemas, QueueRegistry } from "@tulipes/bullmq";
   import { z } from "zod/v4";

   export const jobs = {
     "users.welcome": z.object({ email: z.email(), locale: z.string() }),
   } satisfies JobSchemas;
   ```

   After `pnpm sync`, `queues.add("users.welcome", …)` and `job.data` in the
   processor are typed from it, `add()` validates the payload, and the
   `as { … }` casts on `job.data` come out. A payload the compiler now
   refuses (an optional route parameter passed as a string, say) was a
   runtime hole before.
2. Drop `models.get<T>("Name")` generics where the model file's schema is the
   truth: `models.get("User")` is typed from it once `pnpm sync` has run. Keep
   the generic where the type is deliberately narrower or wider than the
   schema, and for names built at runtime — that overload is unchanged.

## 0.11.0 — the module root, plain routes, inspection

A module's root holds three files: `package.json`, `module.config.ts` and
`module.acl.ts`. Everything else has a folder, and the boot refuses a stray
root file with the folder it belongs in.

1. Move `meta.variables.json` into `package.json` under
   `"tulipes": { "env": [ … ] }` — the same entries — and delete the file.
2. Move `index.ts` to `lib/index.ts` and point `package.json` at it:
   `"exports": { ".": "./lib/index.ts" }`. Importers of `@app/<module>`
   change nothing.
3. Move `schemas.ts` to `schemas/<module>.schemas.ts` and fix the imports
   in `routes/`.
4. Rewrite each routes file as a plain function and drop `tulipes.offline`:

   ```ts
   import { Router } from "express";
   import type { BackendCtx } from "@tulipes/core/boot";
   import { UsersController } from "../controllers/users.controllers.js";

   export default function usersRoutes(ctx: BackendCtx): Router {
     const router = Router();
     const users = new UsersController(ctx);
     router.get("/", ctx.rai({ id: "users:read" }), users.list());
     return router;                       // mounted under config.api.prefix
   }
   ```

   `defineRoutes()` and `runtime()` are gone: controllers are constructed
   from the context and read `ctx.models`, `ctx.config` and the environment
   inside handlers. A returned router is mounted under `config.api.prefix`;
   `ctx.routes.mount(router, "/other")` chooses a path, and
   `ctx.routes.mount(parent, "/tenants/:tenant", child)` nests. Global
   middleware configured from the environment is built on its first request
   (`lazy()` in the reference app's core module), because inspection builds
   every router with the environment unresolved and providers as stubs.
5. `tulipes routes` and `tulipes spec` take no mode: both inspect. Replace
   `tulipes spec --offline …` in `package.json` with `tulipes spec …`, and
   `inspectRoutes({ rootDir })` in tests with
   `boot({ rootDir, mode: "backend", inspect: true, handleSignals: false })`.
6. `dependsOn` is derived from a module's `@app/*` dependencies; keep an
   explicit entry only for ordering without an import.

---

<a id="unreleased--settings-and-bootstrap"></a>

## 0.11.0 — settings declarations, bootstrap cleanups, provider contract 2

`module.config.ts` no longer computes values and no longer carries lifecycle
hooks. It declares the module's **settings**: a zod schema whose values live
in a settings store (core's file store under `config/settings.<APP_ENV>.json`,
or the Mongo store an app declares), seeded with the defaults on first boot,
validated on every write, edited at runtime through `ctx.settings`, and read
live at `ctx.config.<module>`.

1. Rewrite each `module.config.ts` as one export:

   ```ts
   import { defineConfig } from "@tulipes/core/config";
   import { z } from "zod/v4";

   export default defineConfig({
     schema: z.object({
       maxSessions: z.number().int().positive().default(5).describe("Max concurrent sessions"),
     }),
     onChange(next, ctx) {},   // optional: rebuild what depends on a value
   });
   ```

   A value the factory read from the environment becomes a field with that
   variable's default; the variable leaves `meta.variables.json` unless it
   is a secret or boot needs it before the database answers. A value the
   factory computed from other modules' config becomes a plain export of
   the module's own helpers. Tag a field `.meta({ restart: true })` when the
   process cannot apply it without a restart.
2. Move `onReady`, `onDrain` and `onShutdown` bodies into
   `bootstrap/*.bootstrap.ts`. A bootstrap runs in every mode, after
   settings, translations and ACL and before routes or queues; it may
   return the function that closes what it opened, which core runs after
   traffic drains in reverse load order. What `onDrain` did is now
   `ctx.signal.addEventListener("abort", …)`, fired the moment shutdown
   begins. A seed a one-off script should skip checks `ctx.mode === "script"`.
3. Mongoose base plugins keep registering from the sys core module's
   `module.config.ts` at declaration time, which is still before models
   compile; it is the one top-level call that file may make.
4. `pnpm sync`, then `pnpm typecheck`: `ctx.config.<module>` is typed as
   the schema's output. The boot refuses the old forms by name — a factory
   default export, a lifecycle export, a field without a default — and
   `tulipes config:check` prints what each namespace holds.

Providers implement contract **2**: core runs bootstrap files itself, so a
`models` provider's `acquire` only connects and compiles, and
`ProviderContext.runBootstrap` is gone. `@tulipes/mongoose` keeps exporting
the `BootstrapFn` type as an alias of core's.

---

<a id="unreleased--move-to-pnpm"></a>

## 0.11.0 — move to pnpm

Generated apps and the framework repository use pnpm from 0.11; the 0.10
line used yarn 4. The sections below this one predate the move and quote
yarn commands, which is correct for the versions they describe: apply them
with yarn, then switch here. For every app:

1. Install pnpm once per machine: `npm install -g pnpm`.
2. In `package.json`, set `"packageManager": "pnpm@10.28.0"`, delete the
   `workspaces` array, and move `resolutions` to `pnpm.overrides`. The PM2
   pin changes its selector: `"pm2/js-yaml"` becomes `"pm2>js-yaml"`. Add
   `pnpm.onlyBuiltDependencies` naming `esbuild` and, when the app uses
   queues, `msgpackr-extract`; pnpm blocks every other install script.
3. Create `pnpm-workspace.yaml` next to it:

   ```yaml
   packages:
     - modules/*
   ```

4. Delete `.yarnrc.yml`, `.yarn/` and `yarn.lock`, then run `pnpm install`
   and commit `pnpm-lock.yaml`.
5. Replace `yarn <script>` with `pnpm <script>` wherever the app's own
   documentation, PM2 notes or CI quote it; the scripts themselves are
   unchanged. `tulipes update` detects pnpm from the lockfile or the
   `packageManager` field and runs the matching install.

pnpm installs each workspace package with only the dependencies it declares,
so a module importing a package it never listed fails to resolve where yarn's
hoisting let it through. The fix is the declaration AGENTS.md already asks
for: add the dependency to that module's `package.json`.

---

<a id="0100--upgrading-from-09x"></a>

## 0.10.0 — upgrading from 0.9.x

0.10.0 is the stable form of the three candidates below. Apply their sections
oldest-first — they compose, and each one is small:

1. [declare the models provider](#0100-rc1--declare-the-models-provider) —
   `@tulipes/mongoose`, one line in `package.json`.
2. [declare the queues provider](#0100-rc2--declare-the-queues-provider) and
   [the sockets provider](#0100-rc2--declare-the-sockets-provider) —
   `@tulipes/bullmq`, `@tulipes/socket.io`, if the app uses them.
3. [install the CLI package](#0100-rc3--install-the-cli-package) —
   `yarn add -D @tulipes/cli`, and replace a global `@tulipes/core` install.

Install the stable line with plain `@latest`: `@tulipes/core@0.10`,
`@tulipes/cli@0.1`, `@tulipes/spec@0.3`, and whichever providers the app
declares at `0.1`. An app already on `0.10.0-rc.3` changes only its version
ranges.

---

<a id="unreleased--install-the-cli-package"></a>
<a id="0100-rc3--install-the-cli-package"></a>

## 0.10.0-rc.3 — install the CLI package

The `tulipes` command moved out of core into `@tulipes/cli`. For every app:

```sh
yarn add -D @tulipes/cli@next
```

Scripts (`tulipes dev`, `tulipes sync`, `tulipes spec …`, `yarn tulipes new
module …`) need no change — Yarn resolves the binary from the devDependency.
Replace a global `@tulipes/core` install with `npm i -g @tulipes/cli@next`;
`tulipes update` keeps both in step from then on. Core no longer depends on
`tsx`: an app that runs `tsx app.ts` already lists `tsx` itself (generated apps
do), and nothing else changes.

---

<a id="unreleased--declare-the-sockets-provider"></a>
<a id="0100-rc2--declare-the-sockets-provider"></a>

## 0.10.0-rc.2 — declare the sockets provider

For every app with `sockets/` files:

1. `yarn add @tulipes/socket.io@next` in the app root and in every module that
   owns a `sockets/` file.
2. Declare it with the others:

   ```jsonc
   { "tulipes": { "providers": { "models": "@tulipes/mongoose", "queues": "@tulipes/bullmq", "sockets": "@tulipes/socket.io" } } }
   ```

3. Replace `from "@tulipes/core/sockets"` with `from "@tulipes/socket.io"` for
   `SocketRegistry`, `SocketsFn` and `SocketManager`.

- `ctx.sockets`, `sockets.namespace(...)`, `ctx.sockets.of(...)` and the
  backend-only behavior are unchanged; worker, script and inspection boots list
  the provider as "not used" instead of acquiring it.
- Apps without sockets change nothing and stop installing Socket.IO.

---

<a id="unreleased--declare-the-queues-provider"></a>
<a id="0100-rc2--declare-the-queues-provider"></a>

## 0.10.0-rc.2 — declare the queues provider

Upgrade core to `0.10.0-rc.2` first: both new providers require it.

Queues follow the same path models took in 0.10.0-rc.1. For every app with
`queues/` files:

1. `yarn add @tulipes/bullmq@next` in the app root and in every module that
   owns a `queues/` file. Modules keep their own `ioredis` only if they use it
   themselves (the reference app's cache and rate limiter do).
2. Add the declaration next to the models one:

   ```jsonc
   { "tulipes": { "providers": { "models": "@tulipes/mongoose", "queues": "@tulipes/bullmq" } } }
   ```

3. Replace `from "@tulipes/core/queues"` with `from "@tulipes/bullmq"` for
   `QueueRegistry`, `QueuesFn` and `QueueManager`. The old subpath exports only
   a provider that stops the boot with this instruction.

- Without the declaration, a module with a `queues/` file is refused in the
  `providers` phase; a `REDIS_URL` on its own starts no queue. With it, a
  missing `REDIS_URL` is a boot error.
- `ctx.queues`, `requireQueues(ctx)`, `queues.define/process`, `ctx.queues.add`
  and the worker's zero-processor refusal are unchanged. `handle.consumers`
  reports how many consumers the worker serves.
- Apps without queues change nothing and stop installing BullMQ and the
  ioredis copy core carried.

---

<a id="unreleased--declare-the-models-provider"></a>
<a id="0100-rc1--declare-the-models-provider"></a>

## 0.10.0-rc.1 — declare the models provider

Upgrade core, spec and the new provider together: core `0.10.0-rc.1`, spec
`0.3.0-rc.4` (its peer range admits both core lines) and `@tulipes/mongoose`
`0.1.0-rc.1` (peer `@tulipes/core ^0.10.0-rc.1`, `mongoose ^8`).

The database is now selected by the app, not by the presence of `MONGO_URI`,
and the Mongoose implementation lives in its own package. For every app that
has models:

1. `yarn add @tulipes/mongoose@next` in the app root and in every module that
   owns `models/` or `bootstrap/` files (they already depend on `mongoose`;
   keep that — the provider needs it as a peer so schemas and provider share
   one instance).
2. Add one line to the root `package.json`:

   ```jsonc
   { "tulipes": { "providers": { "models": "@tulipes/mongoose" } } }
   ```

3. Replace `from "@tulipes/core/db"` with `from "@tulipes/mongoose"` for
   `ModelDef`, `BootstrapFn` and `ModelStore`. The old subpath now exports only
   a provider that stops the boot with this instruction, and the old type
   imports fail with "no exported member".

- Without it, a module with `models/` or `bootstrap/` files (or a manifest
  `requires: ["models"]`) stops the boot during the `providers` phase, before
  any module code is imported. A `MONGO_URI` on its own no longer connects.
- With it, a missing `MONGO_URI` is a boot error instead of a silent skip.
- `handle.connection` is gone: read `handle.providers` for banner-style status,
  or `handle.ctx.models.connection` when a script or test needs the driver.
- Consumers keep `ctx.models`, `requireModels(ctx)`, `DatabaseCtx`, `ModelDef`
  and `BootstrapFn`; `ctx.models.get` is typed once the provider package is in
  the compilation, which any model file's `ModelDef` import guarantees.
- Apps without a database change nothing and stop installing Mongoose.

---

<a id="unreleased--production-security-upgrade-overview"></a>

## 0.9.0-rc.3 — production security upgrade overview

Upgrade core and spec together to `0.9.0-rc.3` / `0.3.0-rc.3`. Spec rc.3 declares
core `^0.9.0-rc.3`; older core apps should retain their matching spec line until
they migrate. Both packages remain prereleases under `next`.

The S08a–S08m changes apply to editable generated application code as well as core.
Regenerating a starter does not update an existing application. Merge the auth,
users, security and settings changes with local policy, including their models,
helpers, configuration hooks, routes, translations and dependencies, then retain
reference/generated test parity. The sections below give each contract in detail.

Deploy credential-version enforcement across all auth instances together; existing
unversioned sessions require login. Coordinate refresh across clients because
reuse now expires the entire device family. Provision audit insert access and the
shared limiter Redis namespace before enabling privileged endpoints. Check explicit
proxy peers and trusted filesystem directories for the deployment. Restart clients
must consume 202 acceptance, and log clients must handle bounded EOF and reconnect.
Keep settings' early `onDrain` hook separate from resource disposal in `onShutdown`.

Bearer headers and JSON refresh remain the transport. Cookie authentication and
CSRF enforcement require a separately chosen application adaptation. The
[security model](../../docs/security-model.md) and
[Sprint 02 evidence map](../../docs/sprints/production-readiness-02-evidence.md)
separate retained local behavior from pending CI and deployment verification.

<a id="unreleased--early-shutdown-notification-for-long-lived-responses"></a>

## 0.9.0-rc.3 — early shutdown notification for long-lived responses

Modules may export `onDrain(ctx)` from `module.config.ts`. Core invokes these
hooks at the start of shutdown in reverse module load order, before starting its
HTTP/socket/worker drain actions. Hooks and traffic draining then progress
concurrently within the existing total `shutdownTimeoutMs` deadline. Async hook
completion is not ordered across modules. Stop admitting long-lived work and
signal existing responses to end here; keep shared dependencies alive.

`onShutdown(ctx)` still disposes application resources after those drain attempts.
Queues/producers and the database close afterward. A thrown or rejected drain hook
is reported with its module name; a pending hook times out under the same overall
budget. Neither prevents other drain actions or later cleanup from being attempted.
Shutdown remains one operation across repeated/reentrant calls. Notifications may
run during failed boot and in script/runtime inspection cleanup, so tolerate
uninitialized resources. Offline `inspectRoutes()` imports no config and runs no
lifecycle hooks. Non-function `onDrain` exports fail config validation.

Do not block the event loop, wait for the entire shutdown from inside `onDrain`,
or use it to close resources still needed by regular requests/jobs. Timeouts bound
waiting, not arbitrary JavaScript execution. A callback that ignores shutdown can
continue after its deadline; process supervision remains responsible for final
termination. Existing modules without this optional hook keep their cleanup order.

The production starter adds settings' `module.config.ts` and shares its log-stream
manager per boot Environment. Merge that file with the updated controller and
`helpers/log-stream.ts`, preserving custom settings config and existing hooks.
Deploy the updated core alongside these files: older cores do not invoke
`onDrain`. The module preserves app-level `config.settings` values.

Settings drains reject new/late openings with sanitized 503 `LOG_STREAMS_DRAINING`,
end established SSE responses, stop tails/timers and abort cooperative access
checks. An opening paused in authorization also gets 503 without SSE headers;
a late authorization result cannot restart output. Outstanding checks keep their
capacity until they settle, but shutdown does not await that work. The stopped
manager remains associated with that Environment so a late-created controller
cannot reopen it; another boot has its own fresh manager. Slow/non-draining peers
retain the one-second forced socket-close fallback and the framework's overall
HTTP deadline. Healthy log streams no longer force the HTTP drain timeout.

<a id="unreleased--refresh-reuse-expires-the-device-family"></a>

## 0.9.0-rc.3 — refresh reuse expires the device family

Deploy the updated auth token helper and controller together on every backend,
with the session model comments and translations. The existing Session schema,
TTL index and JWT fields remain compatible; no data migration is required. Mixed
backends retain the old reuse behavior on old instances until all are updated.

A valid, unexpired refresh token whose `jti` is no longer current now expires that
session's entire token family. All access and refresh tokens sharing its `sid`
lose authorization, and the device disappears from the active-session list.
Other devices and later logins have different session IDs and remain active.
Invalid signatures, malformed claims, wrong token types, expired tokens and
wrong-owner sessions cannot trigger this action. Signature verification requires
bounded string identifiers, a 24-digit hexadecimal user ID and integer issuance/
expiry timestamps; custom callers must keep those starter token conventions.

**Serialize refresh requests per session, including across browser tabs.** Two
concurrent requests for the same refresh token still produce one 200 and one 401,
but the replay invalidates the winning pair too. There is no grace period or
idempotent replay. After a lost response or 503 REFRESH_UNAVAILABLE, discard the
local pair and sign in again instead of blindly retrying a consumed token. A 401
refresh rejection also requires signing in again. For suspected credential theft,
changing the password revokes every device through the existing credential version.

The helper uses one conditional MongoDB update: it either rotates the current
refresh ID or sets the family's `expires_at` to the Unix epoch. Every session
read already checks expiration, so TTL deletion need not finish before revocation.
The update requests majority/journal acknowledgment with a five-second write-
concern timeout. Connection/server-selection waits are separate. Write failures
return a sanitized 503 with no token pair; the write might still have committed.
There is no claim of rollback or of revocation when acknowledgment fails.

This policy does not identify which caller is the thief. A holder of an old,
still-valid refresh token can force that device to sign in again. Expired
ancestors are rejected without revoking live descendants. Detection requires
reuse; theft with no reuse is not discovered. Already authenticated HTTP requests
are not cancelled by this update. Open log streams recheck authorization under
the bounded lease described below. Real replica-set failover,
client coordination and incident alerting remain deployment follow-ups.

<a id="unreleased--browser-authentication-guidance"></a>

## 0.9.0-rc.3 — browser authentication guidance

Production scaffolds now include `docs/browser-auth.md`. Copy that guide when
updating an existing app, along with the clarified security variable descriptions
and auth/security comments. Regenerate `.env.example` with `yarn sync` so its CORS
help matches the module declarations.

The transport remains Authorization-header access tokens and JSON-body refresh
tokens. `CORS_CREDENTIALS` controls a browser response header; it does not enable
cookie authentication or install CSRF protection. The guide describes the controls
and browser validation needed before an application adds cookies. New retained
HTTP tests check cookie/query-token rejection, JSON-only refresh and absent
Set-Cookie headers. They do not establish a browser cookie-security policy.

<a id="unreleased--restart-acknowledgment-before-execution"></a>

## 0.9.0-rc.3 — restart acknowledgment before execution

Merge settings' PM2 helper, controller and route declaration together. The reboot
endpoint now returns **202 Accepted** with `data.supervised`, `data.accepted` and
`data.scheduled` (the verified process names). It no longer returns `restarted`
as if the operation had completed. Update clients to display an accepted request
and separately check application health after reconnecting.

The durable request audit still precedes PM2 access. All target names are validated
against the installed application's canonical directory before acceptance. Restarts
begin only after Node emits the response's `finish` event; disconnect/error before
finish cancels the prepared restart. This establishes complete response handoff to
the operating system, not a guarantee of receipt by a remote client. No arbitrary
sleep or client-delivery claim is used. Self is restarted last.

PM2 IDs, names, PIDs and ownership are rechecked immediately before each restart,
so a delayed plan cannot restart a replacement process silently. Stopped processes
with PID zero remain eligible. Overlapping requests in one backend return 409
`RESTART_IN_PROGRESS` because the imported PM2 client shares its connection. PM2
callbacks and response completion waits are bounded to five seconds; pre-acceptance
driver failures return a sanitized 503 `RESTART_UNAVAILABLE`.

After acceptance, failures are caught and emitted to stderr as `RESTART_FAILED`
without driver details or a second HTTP response. A daemon may have applied a
command even if its callback times out, and earlier targets may already have
restarted before a later failure. There is no rollback, durable job queue or
completion-status endpoint. The process may exit during its own restart before
its callback or cleanup runs. Operators must use PM2 status/health and collected
stderr for completion evidence. Cross-backend coordination remains deployment
policy; this lock is local to one imported helper.

Maintenance scripts can continue awaiting `restart(targets)` and reading its
`RestartOutcome`; unexpected driver errors now use the sanitized restart error.
The new `restartAfterResponse(res, targets)` owns HTTP acknowledgment and execution.
Both use numeric PM2 selectors, retain scope checks and attempt connection cleanup.
See [Node response finish semantics](https://nodejs.org/docs/latest-v24.x/api/http.html#event-finish_2).

<a id="unreleased--bounded-log-streaming"></a>

## 0.9.0-rc.3 — bounded log streaming

Merge settings' `helpers/log-tail.ts`, new `helpers/log-stream.ts` and controller
changes together. Production starters include the same implementation and HTTP
regressions. Log viewing remains sysadmin-only and subject to S08f request quotas.

The tail accepts the configured basename plus `-backend` or `-worker`, followed
by an optional `.yyyy-MM-dd` date and numeric `.index`, ending in `.log`. A bare
`.log` file also works. Other prefix matches and `current.log` aliases are excluded.
Basenames must use letters, digits, underscore, dot or hyphen, with an alphanumeric,
underscore or hyphen first, up to 128 characters including the process suffix.
Linked directories, symlinks, hardlinks and non-regular matching files are refused.
The configured directory's ancestors must be operator-controlled, as with S08g;
this is not a filesystem sandbox against hostile local directory writers.

History reads at most the final 256 KiB and returns at most the requested 1000
complete lines. It can return fewer lines than requested. A leading fragment and
lines over 16 KiB are discarded; an unfinished final line is retained until its
newline arrives. Live reads are limited to 64 KiB per one-second poll and 8 MiB
per tail overall, even when severity filtering emits nothing. Directory scans
stop after 1024 entries. Inode replacement and observed truncation reset the
cursor. Polling is best-effort: intermediate rotations or truncation/regrowth
between polls may lose entries. These limits do not depend on logger rotation.

Each backend controller allows four active streams, at most two per user; other
replicas enforce their own cap. Excess opens return 429 `TOO_MANY_LOG_STREAMS`.
Streams end after at most 60 seconds, access-token/session expiry, or 1 MiB of SSE
output including ready/heartbeat frames. They disconnect if write backpressure
occurs or a frame would exceed the 64 KiB pending-output budget. Delivery yields
between records so healthy readers can drain history. A pending end is forcibly
closed after one second if it cannot flush. Callers must handle EOF or a transport
error and reconnect with an Authorization header; native browser EventSource
cannot supply that header. No cookie authentication is introduced.

The optional severity filter excludes entries without a numeric level when a
minimum is requested. Initial unsafe-file failures use the normal error envelope;
subsequent failures send a sanitized SSE error code (`LOG_UNAVAILABLE` or
`LOG_READ_LIMIT`) and close. Disconnects stop delivery, clear polling/heartbeats/deadlines and release active
slots; an in-flight filesystem operation is closed/discarded when it settles. Limits are editable constants in the two helpers;
no runtime environment variables or shared Redis connection leases are added.

Merge auth's new `helpers/access-check.ts` and barrel export alongside settings'
new `helpers/access-lease.ts`, updated `helpers/log-stream.ts` and controller.
`LogStreams.open()` is now asynchronous: await it and supply an `authorize(signal)`
callback that reloads current authority and returns a boolean. The supplied checker
captures the original user/session/access-token identity, then reloads current
credential version, session ownership/expiration, token revocation and user role
against `settings:logs`. Refresh rotation alone does not revoke existing access;
refresh reuse, logout, password replacement, session deletion/expiry, user deletion
and permission loss invalidate the stream at its next check.

The controller checks again before opening files or sending SSE headers, then
rechecks once per second with a one-second timeout. A successful decision expires
two seconds from the check's **start**, so a delayed result cannot extend old
authority beyond that bound. Output stops on denial, failure, timeout or lease
expiry, including idle streams; every frame also checks the lease before writing.
The bound assumes a responsive event loop and database reads reflecting committed
authority; it is not instantaneous cancellation or a guarantee about when buffered
bytes reach the client. Socket flushing retains the separate one-second forced
close fallback. A blocked event loop cannot execute timers on schedule.

Opening denial returns 403. Opening failures/timeouts return sanitized 503
`STREAM_AUTHORIZATION_UNAVAILABLE`; after SSE begins, authorization failures end
the response without driver messages or a second HTTP envelope. Each stream runs
one check at a time, and at most four checks can be outstanding per controller
(two per account). Abort is cooperative: the default checker stops between reads
but does not guarantee cancellation of an in-flight database query. A closed or
timed-out stream retains its slot until that check settles, so reconnects cannot
accumulate unbounded database work. Persistent stalled queries can exhaust local
capacity and make new streams return 429 until the queries settle or the process
restarts. Custom callbacks must respect the signal and avoid detached work.

These limits are local to each controller; shared replica leases and load tuning
remain deployment work. The settings `onDrain` hook described above now signals
streams before HTTP waits for completion; disposal hooks still follow draining.
A peer that remains open at the HTTP deadline is force-closed and the timeout is
reported. See [Node response backpressure and close events](https://nodejs.org/docs/latest-v24.x/api/http.html).

<a id="unreleased--constrained-settings-file-access"></a>

## 0.9.0-rc.3 — constrained settings file access

Merge settings' new `helpers/files.ts`, updated env helper and controller, and its
explicit `dotenv` dependency. Existing applications keep their configured env
file and manifest-selected translation locations. The settings API now rejects
symlinked directories/files, hardlinked files and non-regular files with 409
`SETTINGS_FILE_UNSAFE`. Missing locales remain 404. Other filesystem errors return
a sanitized 503 `SETTINGS_FILE_UNAVAILABLE`, without paths or file contents.

Reads use checked file descriptors with no-follow/non-blocking flags and a fixed
1 MiB byte ceiling, including files that grow during a read. Writes also have a
1 MiB ceiling. Directory enumeration stops after 256 entries. JSON must be an
object with at most 64 levels and 10,000 visited nodes; malformed files return 422
`SETTINGS_JSON_INVALID`. Missing-key paths are limited to 4096 bytes each, and the
combined module summary allows at most 10,000 missing keys and 1 MiB of key bytes.
Oversized inputs return 413. Larger catalogs must be edited through deployment
files instead of this console. Log files and streaming follow the bounded log-streaming contract above.

File replacements use an exclusively created temporary sibling, sync its data,
and rename it over the target. Failures before rename preserve the old contents
and clean up the temporary file. Env files are mode 0600 after writing; translation
files retain their existing permission bits. Atomic replacement requires directory
write permission and changes the file inode/owner to the service's temporary file;
custom ACLs/extended metadata are not preserved. This is not a cross-process edit
lock or a power-loss durability guarantee for the directory entry. Audit records
still acknowledge requests before mutation and do not prove completion.

Env editing checks the actual dotenv parse result before replacing anything. It
preserves unrelated lines and their effective values, and accepts only values
that round-trip exactly. Unsupported quoting, CR/NUL values, duplicate assignments
and existing multiline assignments requiring replacement return 422
`ENV_FILE_UNSUPPORTED`; normalize these manually. New multiline values can be
written when a quote form round-trips. They may subsequently need manual editing.
The live process override is updated only after the file write succeeds.

The configured directories and their ancestors must remain under trusted operator
control. Checks reject static linked targets and the leaf open refuses symlink
following, but Node's path-based rename/directory APIs do not provide an openat
sandbox against a local writer racing directory replacements. Do not grant
untrusted users write access to these directories. Configured ancestor paths may
resolve through operator-managed links. See [Node filesystem flags and operations](https://nodejs.org/docs/latest-v24.x/api/fs.html).

<a id="unreleased--shared-production-request-limits"></a>

## 0.9.0-rc.3 — shared production request limits

Update security's package dependencies (`ioredis` and `ipaddr.js`), environment
metadata, route factory, new `helpers/rate-limit.ts` and `module.config.ts`
shutdown hook together. Generated production apps include these changes. Existing
apps must merge their own route/config customizations. Minimal apps are unaffected.

The production starter uses Redis fixed windows before JSON parsing and Passport:

| Policy | Default requests per 60 seconds | Scope |
|---|---:|---|
| `AUTH_RATE_LIMIT` | 20 | Combined POST login, register and password attempts |
| `AUTH_SESSION_RATE_LIMIT` | 120 | Every request under the auth prefix, including refresh, reads, logout and credential attempts |
| `SETTINGS_RATE_LIMIT` | 60 | Every request under the settings prefix, including reveals, writes, restarts and stream openings |

Successful, failed and malformed requests consume quotas. Credential requests also
consume the broad auth quota. CORS preflights handled by CORS do not reach the
limiter. A denied request returns the normal error envelope with 429,
`TOO_MANY_REQUESTS` and a whole-second `Retry-After`. Redis failures return a
sanitized 503 `RATE_LIMIT_UNAVAILABLE` before the protected action. There is no
in-process fallback. Initial connection waiting and Redis commands each have a
one-second bound; reconnection continues in the background. Unrelated public
routes are unaffected. A command that timed out may still have consumed quota.

Set `RATE_LIMIT_NAMESPACE` to a stable identifier shared by all replicas of one
app and distinct from unrelated apps on the same Redis database. The default is
`tulipes`; the application environment is appended automatically. Quotas and
`RATE_LIMIT_WINDOW_MS` must be positive integers up to 2147483647. Apply the same
settings to every replica and restart them together; existing windows expire
naturally. The namespace accepts letters, digits, colon, underscore and hyphen,
with a maximum of 128 characters including the appended environment.

Counters use Express's resolved client IP: configure `TRUST_PROXY_CIDRS` and ingress
headers first. IPv4-mapped addresses share IPv4 counters; IPv6 addresses share a
/56 counter to constrain address rotation. Invalid resolved addresses share one
unknown-client counter. Keys contain a SHA-256 digest of the normalized address,
no credentials, token, email or request body; the digest is not anonymization.
Atomic Redis scripts create counters with expiry, and rejected requests do not
extend their window. See the [Redis counter pattern](https://redis.io/docs/latest/commands/incr/)
and [ipaddr address normalization](https://github.com/whitequark/ipaddr.js).

This is editable starter policy. Tune quotas for NAT users and legitimate clients;
a client exhausting its broad auth quota also delays its logout/revocation calls.
IP limits do not stop distributed credential attacks or provide account lockout.
Windows permit bursts around reset boundaries. Redis eviction, data loss or a new
namespace resets counters: use an appropriately sized store with a suitable
persistence/eviction policy. Store exhaustion fails closed when Redis rejects
writes. Local concurrent/open-stream bounds are described above. Edge traffic
limits, account-aware abuse response and cross-replica/load tuning remain
deployment work.

<a id="unreleased--explicit-production-proxy-trust"></a>

## 0.9.0-rc.3 — explicit production proxy trust

Update security's `meta.variables.json`, route factory and new `helpers/proxy.ts`,
plus the nginx templates. `TRUST_PROXY_CIDRS` defaults to empty, ignoring forwarded
headers. For the supplied nginx-to-local-IPv4-backend topology, set it to
`127.0.0.1/32`. List actual proxy addresses/CIDRs for other deployments; boolean
values, hop counts, named aliases and `/0` ranges are not accepted. Changes require
a restart and are validated during runtime boot, not offline spec generation.

The nginx templates now overwrite forwarded IP/host/protocol headers for a single
public ingress. Replace previous blanket `trust proxy=true` or
`config.http.trustProxy` advice. Multi-proxy deployments must align header handling
and explicit peer ranges at each layer. Sessions and audits use the resolved IP;
shared request limits are described above.

<a id="unreleased--durable-production-settings-audits"></a>

## 0.9.0-rc.3 — durable production settings audits

Update the settings controller and audit helper together, add the generated
`models/audit-event.model.ts`, and include settings' Mongoose dependency and new
`auditUnavailable` translations. Deploy the model with the helper: settings
actions return 503 if an audit insert cannot be acknowledged. Grant the deployment
database identity the required insert access to `settings_audit_events` and include
that collection in operational retention/backup planning.

Custom callers now use `await audit(ctx, req, event)` before an action. The typed
event replaces the action/details arguments and arbitrary payloads; variable and
translation action names now end in `_requested`. Audits no longer appear as
`warn` entries in the normal log stream. Query/archive the dedicated collection;
logging thresholds cannot disable it. Records describe requested actions, with no
old/new values or translation contents. A failed later action is not rolled back
or recorded as completed by this helper.

<a id="unreleased--credential-bound-production-sessions"></a>

## 0.9.0-rc.3 — credential-bound production sessions

Update the editable auth controller, auth helpers, Credential and Session models
together. `setPassword` now returns the version written alongside the hash;
`startSession(ctx, userId, credentialVersion, origin)` requires that exact version.
The local Passport strategy returns `{ user, credentialVersion }` to its login
callback. Carry the verified version through custom sign-in flows; do not replace
it with a later read of the current credential.
For authenticated password changes, pass the session's `credential_version` as
`setPassword`'s fourth argument. That condition prevents overwriting a newer
password; omitting it is reserved for trusted provisioning/reset callers.

Existing sessions without `credential_version` are invalidated on deployment and
users must log in again. Existing credentials gain `version` on successful password
verification through a conditional update; no password reset or bulk backfill is
required. Stop/drain old application processes when deploying the new auth code:
mixed versions do not enforce the same policy. JWT and response formats are unchanged.

The starter no longer reads or advances `User.tokens_valid_from`; migrate custom
revocation code that relied on it. Password replacement invalidates sessions through
the credential version even if later row cleanup fails. In that failure case the
endpoint returns 500, but the new password already applies; log in with it. The
flow does not roll back the credential write when cleanup fails.

<a id="unreleased--production-session-validity"></a>

## 0.9.0-rc.3 — production session validity

Refresh the editable `modules/auth/helpers/tokens.ts` and `passport.ts` from the
updated starter. `loadSession` now requires the token subject as its third argument.
Access and refresh reject expired sessions even before MongoDB TTL cleanup and
require the stored session owner to match that subject. Session listings exclude
expired rows. Apply the credential-version upgrade above alongside these checks.

<a id="unreleased--production-settings-restart-scope"></a>

## 0.9.0-rc.3 — production settings restart scope

Refresh the editable `modules/settings/helpers/pm2.ts` from the updated production
starter. Reboot targets must belong to the installed application's canonical PM2
working directory; an empty list selects only those processes. Mixed valid and
invalid names now fail with 400 before any restart. A daemon without verified
processes for this app returns 503. Keep PM2 `cwd` set to the application root.
The helper restarts numeric IDs to avoid name collisions across applications.

<a id="unreleased--offline-inspection-with-native-routers"></a>

## 0.9.0-rc.3 — offline inspection with native routers

Both new presets retain `routes/*.routes.ts` and native Express Router composition.
Wrap offline-compatible factories in `defineRoutes()` from `@tulipes/core/http`,
and set `tulipes.offline: true` in each module's package.json. Use
`runtime(async ctx => new Controller(ctx))` to acquire controllers once per boot;
its returned binder selects handlers, middleware, param callbacks or error handlers.
Keep service-dependent imports inside that acquisition function. Pure callbacks
can be registered directly. No separate endpoint array or empty declaration file
is needed.

`routes.mount(parent, prefix, router)` records shared prefixes, including named
parameters. `router.use`, `router.param`, `router.route` and `mergeParams` retain
Express semantics. Param callbacks run before endpoint RAI checks. Existing
RoutesFn factories remain supported with `--runtime`; both new starters select
`--offline` in their spec scripts. Declaration imports are trusted JavaScript.

The production prefix lives in `config/routes.ts`. Offline document metadata uses
package.json, with `http://localhost:3000` as the default URL; use `--url` for a
deployment. Register custom access checkers in the router factory so both scans
observe them. See [inspection](./README.md#inspection) for the
full interface, guarantees and migration examples.

## 0.9 release candidate: minimal default and Node 24

`init` now creates a minimal, infrastructure-free API. To generate the previous
full application, pass `--preset production`. Existing applications are unchanged
by this CLI default. `--minimal` and `--preset minimal` are equivalent; unknown
or conflicting options fail before files are written.

Both packages declare Node >=24.0.0 <25. Existing generated apps must manually
copy the auth deployment guard from the reference/template and update their
production PM2 dependency to ^7.0.4. Add the Yarn resolution
`"pm2/js-yaml": "4.3.2"` in the application root manifest to patch PM2's
pinned dependency until upstream ships the fix. Stage this process-manager upgrade and test
start/restart/shutdown before updating the server daemon. Configure unique JWT
keys and replace default admin credentials before staging/production boot.
Generated tests require dedicated test MongoDB and Redis URLs for production;
the minimal tests have no service requirements.

The rc.1/rc.2 releases established the minimal default without offline inspection.
Core 0.9.0-rc.3 and spec 0.3.0-rc.3 add explicit offline native-router inspection
and the security changes above. Provider extraction is still planned. These
candidates publish under `next`. Install the candidate CLI with `npm install -g @tulipes/core@next`;
generated apps select compatible candidate dependencies automatically.

## Reliability contracts (0.8)

Version 0.8 tightens route registration and alters shutdown timing. Existing 0.7
applications should follow these steps. Upgrade `@tulipes/spec` to 0.2 alongside
core; the generator's peer dependency now requires core `^0.8.0`.

1. Put exactly one `rai()` first in each endpoint's method chain. For a chained
   route, give GET and POST separate declarations with distinct IDs. Replace
   `route.all()` with explicit supported HTTP methods. Literal paths and named
   `:parameters` are supported; regex, array, optional and wildcard paths now fail
   boot rather than producing an incomplete specification.
   Keep one declaration per method and URL template: `/items/:id` and
   `/items/:name` count as the same template even with different RAI IDs.
2. Return an unmounted Router from a routes factory as before. When mounting a
   nested router yourself, replace `parent.use('/prefix', router)` with
   `ctx.routes.mount(parent, '/prefix', router)`. Prefixes must be literal paths.
   The helper mounts the router and records its prefix. Ordinary middleware still
   uses `.use()` and remains trusted application code; it can terminate requests
   before an endpoint's authorization executes.
3. Dispose application resources in `onShutdown`. It now runs after HTTP, socket
   and queue consumers drain, in reverse module order. Queues remain available
   for producing jobs until hooks complete; Mongo closes last. Hooks can also run
   during failed boot, so tolerate resources that were never initialized. Avoid
   waiting for a queued job inside a shutdown hook: local consumers have stopped.
4. `shutdown()` is idempotent and removes its signal handlers. The default graceful
   cleanup budget is 10 seconds across the operation; configure `shutdownTimeoutMs`
   in `boot()` if needed. It also bounds waiting for forced cleanup. A timeout
   rejects shutdown and later cleanup is attempted.
   JavaScript cannot cancel arbitrary hook/job code or a synchronous infinite loop;
   a process supervisor remains responsible for final termination. A failed boot
   preserves its original error, including when cleanup also fails.
5. Tooling should use `boot({ rootDir, mode: 'backend', inspect: true })`.
   `tulipes routes` and `tulipes spec` use it automatically. It skips bootstrap tasks,
   socket setup, listening and readiness hooks. Config factories, route factories,
   imports, queue registration, and applicable Mongo/Redis connections still run;
   factories may require them. Inspection is not a sandbox for arbitrary module
   side effects. `listen: false` alone retains its existing bootstrap behavior.
6. Use `ConfigCtx` in configuration factories, `BackendCtx` in routes factories,
   and `DatabaseCtx` in bootstrap tasks. `RuntimeCtx` describes the post-ACL phase.
   Existing `Ctx` remains available for compatibility and lifecycle hooks during
   partial startup. A backend can have no Mongo or queues: `requireModels(ctx)` and
   `requireQueues(ctx)` check those capabilities and return a non-optional service.
7. Declare non-200 success responses in the RAI, for example
   `rai({ id: 'users:create', status: 201 })`. `res.respond({ data })` uses this
   default, and OpenAPI documents it. An explicit response status still overrides
   the default; keep the declaration accurate for handlers that override it.
   Custom access checkers are reported as dynamic, with warnings instead of guessed
   credentials or roles. Configure authorization manually in the generated Postman
   request for these routes.
8. Run `tulipes sync` to regenerate quoted config keys. Kebab-case module names now
   produce valid TypeScript declarations.
9. Custom access checkers may return a boolean or `Promise<boolean>`. Core awaits
   the result before validation or the endpoint handler; only `true` grants access.
   Rejected policies reach the normal error handler. Update JavaScript checkers
   that returned truthy strings or objects to return explicit booleans.
10. Guest auth state now belongs to each request. Refresh the scaffold's
    `modules/auth/helpers/auth.ts` and `passport.ts`, or change shared fallback
    assignments to copies (`req.auth = resolved || { ...GUEST }`). Before RAI,
    `auth(req)` now stores a request-local fallback. Do not mutate the exported
    `ANONYMOUS`/`GUEST` value itself.

## Adopting the settings module (0.7)

The settings module is an infrastructure console reachable only by
`sysadmin`. Nothing forces you to adopt it — `tulipes update` does not
rewrite your modules — but if you copy it into an existing app, **narrow
your `admin` grant first**:

```ts
// modules/auth/module.acl.ts — before
acl.allow("admin", "*");

// after: explicit namespaces, and a sysadmin role
acl.defineRole("sysadmin");
acl.allow("admin",    "auth:*", "users:*", "…your modules");
acl.allow("sysadmin", "auth:*", "users:*", "…your modules");
```

`*` reaches `settings:*` like any other id, so leaving it in place means
every admin can read your secrets and restart production. After narrowing,
remember that a **new** module's namespace must be added to both grants or
neither role can reach it.

Then promote one account: `sysadmin` is a role no one holds by default.

## 0.4 → 0.5

Three separate breaks: the response shape, the `HttpError` signature, and
persisted field names. The last one needs a database migration.

### Responses are enveloped

Every response is now `{ success, data, errors, meta }`. **Clients must
unwrap `data`.** There is no compatibility mode — a half-enveloped API is
worse than either shape, because a client cannot tell which it is holding.

```ts
// before
res.json({ id, email });
res.status(201).json(user);

// after
res.respond({ data: { id, email } });
res.respond({ status: 201, data: user });
```

`res.json` still exists and still behaves exactly as express defines it —
it simply ships an unenveloped body. In development, any route that answers
without `res.respond` logs a warning naming it, which is the fastest way to
find the ones you missed:

```
[tulipes] users:read GET /users answered without res.respond — body is not enveloped
```

Paginated endpoints move to `req.page`, and pass the count they already had
to query for:

```ts
// before
const limit = Math.min(Number(req.query.limit ?? 20), 100);
const users = await User.find().limit(limit).lean();
res.json({ count: users.length, users });

// after
const { per_page, skip } = req.page;
const [users, total_items] = await Promise.all([
  User.find().skip(skip).limit(per_page).lean(),
  User.countDocuments(),
]);
res.respond({ data: users, meta: { total_items } });
```

### `HttpError`'s third argument is an options object

```ts
// before
throw new HttpError(404, req.t("notFound"), { hint: "…" });

// after
throw new HttpError(404, "notFound", { details: { hint: "…" } });
```

The message is now an i18n **key**: it is translated in the module's
namespace and the error code derives from it (`notFound` → `NOT_FOUND`).
Passing an already-translated string still works — a string that resolves
to no key is used as written — but then name the code yourself, since there
is no key to derive it from:

```ts
throw new HttpError(403, req.t("registrationClosed", { mode }), {
  code: "REGISTRATION_CLOSED",
});
```

### Persisted fields are snake_case — this needs a migration

`created_at`, `updated_at`, `last_seen_at`, `password_hash`,
`tokens_valid_from`, `expires_at`, `is_deleted`.

**Renaming a schema field does not rename it in existing documents.** Rows
written before the upgrade keep the old key and stop matching queries. The
most visible symptom is that **nobody can sign in**, because the credential
lookup asks for `password_hash` on documents that have `passwordHash`.

Write a bootstrap task before deploying — it is idempotent, so it is safe on
every boot:

```ts
import type { Ctx } from "@tulipes/core/boot";

export default async function renameToSnakeCase({ models }: Ctx): Promise<void> {
  await models!.get("Credential").collection.updateMany(
    { passwordHash: { $exists: true } },
    { $rename: { passwordHash: "password_hash" } },
  );
  await models!.get("User").collection.updateMany(
    { tokensValidFrom: { $exists: true } },
    { $rename: { tokensValidFrom: "tokens_valid_from" } },
  );
  // …and createdAt/updatedAt on every collection that has them.
}
```

Use `.collection` rather than the model: the renamed field no longer exists
on the schema, so a model-level query cannot address it.

Delete the task once it has run everywhere.

---

## 0.3 → 0.4

`req.principal` is replaced by `req.auth`.

```ts
// before
const who = req.principal ?? ANONYMOUS;
who.id; who.role; who.authenticated;

// after
const { isAuthenticated, user, session } = req.auth;
user?._id; user?.role;
```

`req.auth.user` is the **hydrated user document**, not a lean summary, so
anything on your user model is available — and a mutation you save through
it reaches the database. `req.auth.session` is the session row plus the
access token in hand (`access_jti`, `access_issued_at`,
`access_expires_at`).

Tell TypeScript what those hold, in your auth module:

```ts
declare module "@tulipes/core/http" {
  interface AuthUser extends UserDoc {}
  interface AuthSession extends SessionDoc {}
}
```

The ACL now reads the role through `req.auth.user.role`. If your roles live
somewhere else — a claims service, a join table — replace the decision
rather than faking a user:

```ts
ctx.routes.setAccessChecker((req, info) => myPolicy(req, info.id));
```

If you carry the scaffold's auth module, refresh tokens moved from a
`RefreshToken` collection to `Session` rows that survive rotation. Existing
refresh tokens do not carry the `sid` claim and will be rejected — a
one-time forced re-login. Drop the old collection after deploying.

---

## 0.2 → 0.3

`requirePermission` and `requireAuth` are gone. A route's RAI **is** the
permission check:

```ts
// before
router.get(`${base}/invoices`, requirePermission(ctx, "invoices:read"), handler);

// after
router.get(
  `${base}/invoices`,
  rai({ id: "invoices:read", name: "List invoices" }),
  billing.list(),
);
```

**Every route must declare one, or the boot aborts.** That is the point:
the pipeline authenticates rather than rejects, so a route with no check was
never private — it was reachable by `guest`. The scan turns that from a
silent exposure into a failed deploy.

```
TulipesBootError: Boot aborted during "routes" — 1 issue(s):
  ✖ GET /api/v1/invoices has no rai() declaration — every route must
    declare one, or it is reachable by anyone
```

A route that only needs "somebody is signed in" still declares a RAI and
grants it to `user`. A public route grants its id to `guest`.

Two routes sharing an id also abort the boot, so ids stay unique across the
application.

### i18n arrived in the same release

It is additive — a module with no `i18n/` folder simply has nothing to say —
but if you add one, `<defaultLocale>.json` must exist and every locale file
must parse, or the boot aborts.

---

## 0.1 → 0.2

Additive. The scaffold gained a JWT auth module and a `guest` role; nothing
in `0.1` was removed. If you had your own auth, keep it — core only requires
that something sets the caller on the request.
