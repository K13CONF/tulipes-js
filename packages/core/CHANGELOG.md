# Changelog

All notable changes to `@tulipes/core`.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the major version is `0`, a minor bump may carry breaking changes —
`0.2 → 0.5` each did. Upgrading across any of them needs the notes in
[MIGRATING.md](./MIGRATING.md).

## [Unreleased]

### Added

- **Time zones.** `config.timezone` in `config/app.config.ts` names the
  app's zone — `{ default: "Africa/Casablanca", supported?: [...],
  applyToProcess?: boolean }`. An app without the block behaves as before:
  instants read in UTC and the process zone is not touched.
- A request negotiates its zone like its locale — `?tz=`, then an
  `X-Timezone` header, then `config.timezone.default`, narrowed to
  `supported` when it is listed — and reads it as `req.timezone`, with
  helpers bound to it on `req.time` (`format`, `toISO`, `startOfDay`,
  `fromWallClock`, `offsetMinutes`). Code with no request uses `ctx.time`,
  and `ctx.time.in(zone, locale)` for a recipient's zone.
- Naming a zone also sets `process.env.TZ` for the life of the boot (not
  under inspection; restored at shutdown), so `Date#getHours()`, log
  timestamps and daily log rotation agree with the app. Opt out with
  `applyToProcess: false`.
- `@tulipes/core/time`: `toZonedISO`, `startOfDay`, `zonedTimeToUtc`,
  `offsetMinutes`, `formatDate`, `canonicalTimezone`, `resolveTimezone`.
- An unknown zone in `config.timezone` aborts the boot in a new
  `timezone` phase (7b, after translations). The banner shows the zone.
- `@tulipes/bullmq`: a cron `pattern` with no `tz` fires in
  `config.timezone.default`, through `add(..., { repeat })` and the new
  `ctx.queues.schedule(queue, schedulerId, repeat, job)` /
  `unschedule()`, which wrap BullMQ's job schedulers and validate the
  template's data against the queue's schema.

Dates on the wire are unchanged: stored and returned as UTC ISO strings.

## [0.12.0-rc.1] — 2026-10-12

The 0.12 line as a candidate, on npm's `next` tag. Breaking for every app
on 0.11: every RAI id gains a scope. `tulipes migrate 0.12` carries the
ids, grants and references across; the migration guide says what is left
to decide by hand. Packages: core `0.12.0-rc.1`, `@tulipes/cli`
`0.3.0-rc.1`, `@tulipes/spec` `0.4.0-rc.1` (requires core
`^0.12.0-rc.1`), `@tulipes/mongoose` and `@tulipes/bullmq` `0.2.1-rc.1`,
`@tulipes/socket.io` `0.1.3-rc.1`, `@tulipes/mcp` and `@tulipes/testing`
`0.1.1-rc.1` (no source change; their core peer range admits
`^0.11.0 || ^0.12.0-rc.1`).

### Changed

- **A RAI id is `module:scope:resource[:extra]`** — `users:bo:list`,
  `users:mobile:profile`, `users:bo:detail:delete`. Every segment is
  `[a-z][a-z0-9-]*`. The route scan and agent declarations refuse any
  other shape with the route or action named, and a 0.11 id or grant is
  reported as having no scope, with the command that rewrites it; `RouteInfo.id` and
  `ActionTool.id` are typed `Rai`, so a two-segment id is an editor error.
- **Grants resolve prefix wildcards at every depth.** `users:bo:*` and
  `users:bo:detail:*` are valid grants; a prefix covers the bare resource
  as well as everything under it. `acl.allow()` refuses anything that is
  not an id, a prefix wildcard or `*`.
- The explorer reads `*.routes.<ext>` in subfolders of `routes/`, so a
  module can group several routes files for one scope (`routes/web/`).

### Added

- `defineRole(name, { description, ...extras })`: a role carries a
  description and any property the app reads back. `RoleMeta` types the
  extras by augmentation. `acl.role(name)` and `acl.describeRoles()` return
  frozen records with `name` and `definedBy`.
- `acl.rolesFor(permission)`: who holds a permission, resolved exactly as
  a request is. `tulipes routes`, `@tulipes/spec` and the reference
  console use it instead of their own copies.
- `parseRai`, `isRai`, `isGrant`, `grantsCovering` and the `Rai` type, from
  `@tulipes/core/acl` (`parseRai`, `isRai` and `Rai` also from
  `@tulipes/core/http`).
- CLI: `tulipes roles [--role r]`; `--scope` on `tulipes routes`,
  `tulipes spec` and `tulipes new module`; `tulipes migrate 0.12 [--scope s]`.
- Spec: `extract(ctx, { scope })`, `SpecRoute.scope`, `SpecSource.roles` and
  `.scopes`; OpenAPI `x-tulipes-scope` per operation and document-level
  `x-tulipes-roles` / `x-tulipes-scopes`. Postman's default login id is
  `auth:web:login`.
- The reference app and `tulipes new module` name routes and controllers
  scope-first (`routes/web.users.routes.ts`, `BoUsersController`), a
  convention core does not enforce.

## [0.11.0] — 2026-10-08

The 0.11 line, stable: every entry below is breaking for an app on 0.10, and
`tulipes migrate 0.11` carries most of it across; the migration guide lists
the rest. Published packages: core `0.11.0`, `@tulipes/cli` `0.2.0`,
`@tulipes/spec` `0.3.2`, `@tulipes/mongoose` `0.2.0`, `@tulipes/bullmq`
`0.2.0`, `@tulipes/socket.io` `0.1.2`, and the first `@tulipes/mcp` and
`@tulipes/testing` at `0.1.0`. The providers, mcp and testing require core
`^0.11.0` (provider contract 2); spec accepts `^0.10.0 || ^0.11.0`.
Candidates on `next` before it: rc.1 (2026-10-07) and rc.2 (2026-10-08);
their `agent/` files and `tulipes update` differ as noted below.

The agent surface and `@tulipes/mcp` are **experimental**: outside the
compatibility promise, may change in any release (`docs/support.md`).

- **`@tulipes/testing`.** `useTestApp({ rootDir, env, settings }, { beforeAll,
  afterAll })` boots the app once per test file on a free port and shuts it
  down; `app.request()` and the `get`/`post`/`patch`/`delete` shorthands
  decode the envelope and type it; `app.api()` prefixes the configured API
  prefix; `app.register()`, `app.login()` and `app.as(role)` use the auth
  module the production preset ships. The reference suite is one file per
  module under `modules/<name>/tests/` on it, with the app-level parity test
  in `tests/`; both presets' vitest configs run files one after another.
- **`tulipes migrate 0.11` and `tulipes config:import`.** The CLI rewrites
  an app generated on 0.10: pnpm manifest and workspace file, node scripts
  and compiler flags, the variables file into `tulipes.env`, `index.ts`
  into `lib/`, `schemas.ts` into `schemas/`, `.ts` specifiers, declared
  fields for parameter properties, plain routes functions with static
  controller imports (other `runtime()` uses keep their semantics through a
  generated helper), `defineConfig` written from the config factory, the
  lifecycle exports moved into a bootstrap file, `inspectRoutes()` into an
  inspection boot, and the root's devDependencies completed for what its
  own files import. `config/migration-0.11.json` records which variables
  became which settings; `config:import` reads it and the env file and
  writes the values through the app's store, validated by each schema.
  The upgrade harness runs a real 0.10 app through both.
- **Production without tsx.** Node strips types natively, so generated
  apps run `node app.ts`, `tulipes dev` is `node --watch`, PM2 runs node
  directly and `tsx` is gone from every manifest. Relative imports name
  `.ts` files, `tsconfig` sets `allowImportingTsExtensions`,
  `rewriteRelativeImportExtensions` and `erasableSyntaxOnly`, and
  `types/tulipes.d.ts` uses `.ts` specifiers. The CLI refuses a node that
  cannot strip types with the reason instead of a late syntax error. The
  workspace packages follow the same rules (their emitted JavaScript still
  carries `.js` specifiers), so every test and harness runs on plain node.
- **The reference app on 0.11 (production preset).** The environment is
  eleven variables: `PORT`, `MONGO_URI`, `REDIS_URL`, `LOG_LEVEL`,
  `LOG_CONSOLE`, `LOG_FILE`, `LOG_DIR` and the four auth secrets; proxy
  trust, CORS, HSTS, the body limit and the rate limits are `security`
  settings rebuilt from `onChange`, `PUBLIC_DOMAIN` is `core.publicDomain`,
  and the log file names and rotation are constants. A `config` module
  serves the console — `GET /config`, `GET /config/:module`,
  `PATCH /config/:module` (schema-validated, version-checked, audited
  without values, hot-applied) — and the `settings` module keeps only
  `GET /settings/logs/stream`. The auth module caches a resolved session
  in the app cache for `auth.cacheTtlSeconds` (bounded by `accessTtl`) and
  forgets it on every revocation path, so a hit is one Redis read and a
  revocation is refused on the next request on any replica; `forgetUser()`
  is exported for code that writes a role.
- **The Mongo settings store.** `@tulipes/mongoose/settings` is the
  `settings` provider: one document per namespace in `settings` (`_id`,
  `values`, `version`, `updated_at`, `updated_by`), writes refused on a stale
  version with the current document in the error, the replaced document
  kept in `settings_history`, other processes' writes delivered by a change
  stream on a replica set and by polling otherwise. It shares the models
  provider's connection or opens its own from `MONGO_URI`. The production
  preset declares it; the minimal preset keeps the file store.
- **The agent surface: actions, declared apart from the API.**
  `agent/*.agent.ts` exports `defineAgent({ summary, actions })`; an action
  is `action({ id, description, input, readOnly, handler })` — the id is a
  permission granted in `module.acl.ts`, the input a zod schema emitted as
  JSON Schema, and it runs gated like a route: ACL on the id, then the
  schema, then the handler with the runtime context and the actor. Routes
  are never tools and nothing is derived from a `rai()`; a module with no
  `agent/` file offers nothing. `ctx.agent` is built from the declarations
  after the ACL in every mode (backend, worker, script, inspection) and
  gives `manifest(role)`, `tools(role)`, `find(name)` and `invoke(name,
  input, actor, req?)` — what an agent module inside the app hands a model
  and routes each tool call to. `tulipes agent manifest` writes the
  document from an inspection boot; the generated apps carry an `agent`
  module serving `GET <prefix>/agent/tools` and `POST <prefix>/agent/tools/:name`
  for agents outside the process; the new `@tulipes/mcp` package
  (`tulipes-mcp`) serves that door to MCP clients with a bearer token. (The
  candidates derived a tool from every route, with `tools`, `{ route }`,
  `agent: false` and a `transport` field; `tulipes migrate 0.11` rewrites an
  rc app's files.)
- **`tulipes update` never downgrades and moves every package together.**
  It compares by semver and raises a plain version range only when the
  target is newer, leaves `workspace:`, `file:` and compound ranges alone,
  and moves every declared `@tulipes/*` package to the version paired with
  the new core, fetching all of them before writing. (The rc.1 CLI followed
  npm's `latest` tag blindly and downgraded a candidate app.)
- **The file settings store polls as a floor.** Besides `fs.watch`, it
  re-reads its file every 2 s, unref'd, so a change another process wrote
  is applied even when the watcher drops the event (macOS under load).
- **Generated model and job types.** `tulipes sync` now writes
  `types/tulipes.d.ts` (replacing `types/config.d.ts`, which it removes)
  with two more augmentations: `KnownModels` in `@tulipes/mongoose`, one
  entry per model file keyed by the model's literal name and typed as the
  file's default export, so `ctx.models.get("User")` returns the model
  mongoose infers from that schema; and `KnownJobs` in `@tulipes/bullmq`,
  derived from each queue file's new `jobs` export (`{ [queue]: zodSchema }`),
  so `queues.add()` and `job.data` in the processor agree on the payload. A
  queue listed in `jobs` is defined without a separate `define()` call and
  `add()` validates every payload with its schema. Names codegen does not
  know keep the caller-side generic and untyped (`any`) payloads.
- **The module root is three files.** `package.json` (with the env contract
  under `tulipes.env`, replacing `meta.variables.json`), `module.config.ts`
  and `module.acl.ts`; public exports move to `lib/index.ts` behind
  `package.json` `exports`, request schemas to `schemas/`. A stray root file
  refuses the boot with the folder it belongs in. `dependsOn` is derived
  from a module's scoped dependencies.
- **Plain routes and one inspection.** A routes file is `(ctx) => Router |
  void`; a returned router is mounted under `config.api.prefix`, and
  `ctx.routes.mount(router, path)` chooses another. `defineRoutes()`,
  `runtime()`, `tulipes.offline`, `inspectRoutes` and the `--offline` /
  `--runtime` flags are gone: `tulipes routes` and `tulipes spec` run
  `boot({ inspect: true })`, which mounts every route with the environment
  declared but unresolved, providers as stubs that throw on use, settings
  as defaults and no bootstrap — no service, secret or `.env` needed.
- **Settings declarations.** `module.config.ts` has one export,
  `defineConfig({ schema, onChange })`: a zod schema with a default for every
  field. Values live in a settings store — core's file store under
  `config/settings.<APP_ENV>.json`, or the store a `settings` provider
  supplies — seeded on first boot, validated on every write, edited at
  runtime through `ctx.settings.set()` and read live at `ctx.config.<module>`;
  a field tagged `.meta({ restart: true })` persists and applies on the next
  boot. The factory form and the `onReady`/`onDrain`/`onShutdown` exports are
  refused by name.
- **Bootstrap is the lifecycle.** `bootstrap/*.bootstrap.ts` runs in every
  mode (scripts included) after settings, translations and ACL and before
  routes or queues, and may return its cleanup, run after traffic drains in
  reverse load order. `ctx.signal` aborts when shutdown begins. A
  `bootstrap/` directory no longer implies a models provider.
- **Provider contract 2.** Core runs bootstrap; `ProviderContext.runBootstrap`
  is gone; a `settings` capability joins models, queues and sockets, acquired
  with models before the settings load while queues and sockets are acquired
  after bootstrap. `tulipes config:check` prints every namespace. The
  reference app's token lifetimes, signup mode, session cap and greeting
  became settings (32 → 27 environment variables); its production credential
  check is a bootstrap.
- Generated production apps and the workspace override `basic-ftp` to 6.2.1
  and mute the unfixable braces advisory (GHSA-vfj7-8cjw-p6xm), both in
  PM2's transitive tree; see the dependency review of 2026-10-07 in
  `docs/security-model.md`.
- **`tulipes init` copies the reference application** instead of rendering
  6,659 lines of string literals: the published CLI packs `example/` into
  `templates/app` at build time with the workspace versions, applies the app
  name, pins the framework ranges and drops or overlays what `--no-queues`
  and `--no-sockets` leave out. The minimal preset is a committed tree. The
  example gains the files only a generated app had (`ecosystem.config.cjs`,
  a standalone `tsconfig.json`, the PM2 scripts) and its README, env seeds
  and `app.config.ts` are the generated ones.
- **pnpm replaces yarn** for generated apps and the repository. `tulipes init`
  writes `packageManager: pnpm@10.28.0`, a `pnpm-workspace.yaml` naming
  `modules/*`, `pnpm.overrides` in place of `resolutions` and an
  `onlyBuiltDependencies` allow-list; the `.yarnrc.yml` is gone. `tulipes
  update` defaults to pnpm when no lockfile says otherwise. Existing apps
  follow the pnpm section of [MIGRATING.md](./MIGRATING.md).

## [0.10.1] — 2026-09-12

A patch release: nothing in the runtime changed, and no migration is needed.
Published with `@tulipes/cli@0.1.1`, `@tulipes/spec@0.3.1` and the providers at
`0.1.1` — packing rewrites each package's core dependency, so a core version
bump changes every archive.

- Generated apps get an **`AGENTS.md`** — the cross-tool convention coding
  agents read — carrying the project rules that used to live only in
  `CLAUDE.md`. `CLAUDE.md` remains as a short bridge to it, so Claude Code
  still picks the instructions up automatically, and the task-scoped skills
  under `.claude/skills/` are unchanged.

## [0.10.0] — 2026-09-12

The first stable release of the 0.10 line, published to `latest` with
`@tulipes/cli@0.1.0`, `@tulipes/spec@0.3.0`, `@tulipes/mongoose@0.1.0`,
`@tulipes/bullmq@0.1.0` and `@tulipes/socket.io@0.1.0`.

It contains everything in the `0.10.0-rc.1`…`rc.3` candidates below — the
provider seam and the extraction of Mongoose, BullMQ and Socket.IO out of core,
the command line moving to `@tulipes/cli`, feature composition in the production
preset — plus the three operational fixes listed under Unreleased above.
Upgrading from 0.9.x means following every `0.10.0-rc.*` section of
[MIGRATING.md](./MIGRATING.md) in order; they compose.

Stable means the API of this line is settled and breaking changes wait for
0.11: core installs 7.6 MB against 53 MB for 0.9, and the supported journeys
are exercised by CI on every commit. It does **not** mean production-proven —
no pilot deployment has run this yet; see [support.md](../../docs/support.md).

- Accept a replica set's multi-host connection string in a `url` variable
  (`mongodb://a:27017,b:27017/db?replicaSet=rs0`). WHATWG URL parsing rejects
  that form, so declaring the most common self-hosted MongoDB topology made the
  app refuse to boot. Every host in the list must still parse on its own.
- `@tulipes/socket.io`: closing a server that never attached is a no-op, so a
  boot that failed before `listen()` reports its own failure instead of a
  `TypeError` from Socket.IO's cleanup.
- Generated apps: the Redis cache degrades instead of failing requests. It is
  read from global middleware, so an outage used to surface as 500 on every
  endpoint after a 20-retry stall; the client now fails fast and every cache
  operation falls back to "no cache".

## [0.10.0-rc.3] — 2026-09-12

Released with the first `@tulipes/cli@0.1.0-rc.1`, plus `@tulipes/spec@0.3.0-rc.6`,
`@tulipes/mongoose@0.1.0-rc.3`, `@tulipes/bullmq@0.1.0-rc.2` and
`@tulipes/socket.io@0.1.0-rc.2`; all use `next`. Every app must install the CLI
package — see [MIGRATING.md](./MIGRATING.md#0100-rc3--install-the-cli-package).

- `@tulipes/bullmq`: a consumer that is still connecting settles before it is
  closed, so a graceful shutdown cannot die of an unhandled "Connection is
  closed." rejection from its offline command queue; raw connections carry an
  error listener.

- `tulipes init --preset production` accepts `--no-queues` and `--no-sockets`
  (Sprint 05, S14): the generated app omits that provider's declaration,
  dependencies, files and worker process, and its controllers do the work
  in-request instead. Both flags are rejected with the minimal preset before
  any file is written. The packed smoke runs the variants.

- **Breaking:** the command line moved to `@tulipes/cli` (Sprint 05, S12).
  Core ships no `tulipes` binary, no `templates/` and no `tsx`; its runtime
  dependencies are express, zod, i18next, i18next-fs-backend, dotenv and
  colorette. Install the CLI globally (`npm i -g @tulipes/cli@next`) and add it
  to an app's `devDependencies` — generated apps do — so `yarn dev`, `yarn sync`
  and `yarn tulipes …` resolve as before. `tulipes update` upgrades the global
  CLI and the app's core and CLI ranges. `readProviderDeclarations` is exported
  from `@tulipes/core/boot`. Measured: a core-only install drops from 26.95 MB
  to about 8 MB and the archive from 351 KB to 203 KB.

## [0.10.0-rc.2] — 2026-09-12

Released with the first `@tulipes/bullmq@0.1.0-rc.1` and `@tulipes/socket.io@0.1.0-rc.1`,
plus `@tulipes/spec@0.3.0-rc.5` and `@tulipes/mongoose@0.1.0-rc.2` (no source
change; republished because packed manifests record the core version they were
built against). All candidates use `next`. Apps with queues or sockets must
follow [MIGRATING.md](./MIGRATING.md#0100-rc2--declare-the-queues-provider);
apps without them change nothing and stop installing BullMQ, ioredis and
Socket.IO through core.

- `@tulipes/bullmq`: producers and consumers observe driver errors instead of
  letting BullMQ's re-emitted "error" events crash the process; `close()` lets a
  still-initializing queue finish before quitting its connection.
- **Breaking:** the Socket.IO sockets provider moved to `@tulipes/socket.io`
  (Sprint 04, S11). Core no longer depends on `socket.io`; `SocketRegistry`,
  `SocketsFn` and `SocketManager` are imported from the provider,
  `@tulipes/core/sockets` is a migration stub, and an app selects sockets with
  `"tulipes": { "providers": { "sockets": "@tulipes/socket.io" } }`. A `sockets/`
  file implies the requirement. Providers may declare `situations`
  (`backend`, `worker`, `script`, `inspect`) and are skipped — reported, not
  failed — elsewhere; resources gain `attach(server)`, called in the backend
  after routes mount and before listen, never during inspection. `ctx.sockets`
  is an augmentable `SocketsCapability`. With models, queues and sockets all
  extracted, core's runtime dependencies are express, i18next, zod, dotenv,
  colorette and tsx.

- **Breaking:** the BullMQ queues provider moved to `@tulipes/bullmq` (Sprint 04,
  S10). Core no longer depends on `bullmq` or `ioredis`; `QueueRegistry`,
  `QueuesFn` and `QueueManager` are imported from the provider, `@tulipes/core/queues`
  is a migration stub, and an app selects queues with
  `"tulipes": { "providers": { "queues": "@tulipes/bullmq" } }`. A `queues/` file
  implies the requirement; `REDIS_URL` alone starts nothing. `ctx.queues` is an
  augmentable `QueuesCapability`; `BootHandle.consumers` counts what the worker
  serves. Providers gain optional `serve()` (worker mode) and `drain()`
  (first shutdown phase) hooks; the shutdown order is unchanged. The
  application's own Redis clients (cache, rate limiter) are untouched and keep
  their own `ioredis`. `tulipes new module` emits the queues file only when a
  queues provider is declared (`--queues` / `--no-queues`).

## [0.10.0-rc.1] — 2026-09-12

Released with `@tulipes/spec@0.3.0-rc.4` and the first `@tulipes/mongoose@0.1.0-rc.1`;
all three use `next`. Apps with models must follow
[MIGRATING.md](./MIGRATING.md#0100-rc1--declare-the-models-provider); apps
without a database change nothing and stop installing Mongoose.

- **Breaking:** the Mongoose provider moved to `@tulipes/mongoose` (S09.4–S09.6).
  Core no longer depends on, imports or declares anything from `mongoose`;
  `ModelDef`, `BootstrapFn` and `ModelStore` are imported from the provider
  package, and `@tulipes/core/db` is a migration stub whose only export is a
  provider that reports the move. A packed minimal app cannot resolve
  `mongoose`, `mongodb`, `bson` or `@tulipes/mongoose`; the smoke asserts it.
  `tulipes new module` emits model/bootstrap files only when the app declares a
  models provider (`--model` / `--no-model` override). Release tooling packs and
  verifies three archives and refuses a core declaration that imports mongoose.
- Add the provider seam (S09.2): an app selects its database with
  `"tulipes": { "providers": { "models": "@tulipes/mongoose" } }` in its root
  `package.json`; modules with `models/` or `bootstrap/` files, or a manifest
  `requires: ["models"]`, are refused before any module code is imported when
  no provider is declared. `ctx.models` is typed as an augmentable
  `ModelsCapability`; `BootHandle.connection` is replaced by
  `BootHandle.providers` statuses and `ctx.models.connection`. A `MONGO_URI`
  without a declaration no longer connects; a declared provider without one is
  a boot error. Offline inspection validates declarations without importing
  the provider. `@tulipes/core/boot` exports the `Provider` contract.

## [0.9.0-rc.3] — 2026-09-11

Released with `@tulipes/spec@0.3.0-rc.3`; both candidates use `next`.
Existing generated apps must merge the security and router changes described in
[MIGRATING.md](./MIGRATING.md); installing core alone does not update app policy.

- Add optional `onDrain` module hooks at the start of shutdown, sharing the traffic
  drain deadline and aggregate cleanup errors. Production settings use the hook
  to stop log streams, reject late openings and abort pending authorization before
  resource disposal; a subsequent boot gets fresh stream admission.

- Revoke a device's entire session family on valid refresh-token reuse. Duplicate
  concurrent refreshes invalidate the winning pair too; clients must serialize
  refresh and sign in again after rejection or an uncertain acknowledgment.
- Add shared Redis fixed-window auth/settings quotas, normalized proxy-aware client
  identities, 429 retry guidance and bounded fail-closed 503 responses.
- Constrain settings file reads/writes, links, JSON expansion and dotenv values;
  use bounded descriptor reads and atomic sibling replacement with private env files.
- Bound log history, polling, output, backpressure, stream capacity and lifetime.
  Revalidate current session/credential/user/ACL authority during open SSE with a
  two-second authorization lease and bounded pending checks.
- Return complete HTTP 202 acceptance before executing prepared PM2 restarts;
  cancel on premature disconnect and revalidate process identity before commands.
- Ship browser bearer/JSON transport guidance and retained boundary tests, with
  explicit client refresh coordination and conditional cookie/CSRF requirements.

- Add explicit production proxy IP/CIDR trust with direct-peer defaults and
  forwarded-header regressions. Update single-ingress nginx templates to overwrite
  forwarded IP/host/protocol headers and remove blanket-trust guidance.

- Persist settings audit requests with majority/journal acknowledgment before
  secret reveals, file/environment changes and restarts. Fail closed on audit
  errors, independently of logging thresholds; omit values from audit records.

- Bind production sessions to an atomically written credential version, closing
  delayed login/password-change races and preserving revocation when cleanup fails.
  Existing sessions require login again; legacy credentials upgrade on login.

- Require live, matching-owner sessions for production access authentication and
  atomic refresh rotation; exclude expired devices from session listings.

- Scope production settings restarts to the application directory, validate targets
  before action, and use PM2 process IDs to isolate duplicate names.

- Add `defineRoutes()`, deferred runtime callback binding and `inspectRoutes()` for native router inspection.
- Add explicit `routes/spec --offline` and `--runtime`, with strict option parsing.
- Keep both starters on native routers, shared prefixes and offline spec scripts.
- Support named mount parameters while preserving middleware, param callbacks and error-handler arity.
- Verify runtime route/schema parity and deterministic packed spec generation with
  service connections denied; retain legacy runtime inspection.

## [0.9.0-rc.2] — 2026-09-09

- Override PM2's js-yaml dependency to 4.3.2 for GHSA-2883-xcg3-v3hh.
- Preserve generated dependency overrides in packed-install verification.
- rc.1 was tagged but its audit gate blocked npm publication. Neither candidate
  package from rc.1 was uploaded; rc.2 replaces it without moving the old tag.

## [0.9.0-rc.1] — 2026-09-08

- Default minimal starter, explicit production preset and generated Vitest suites.
- Production/staging credential guard and retained concurrent refresh/logout checks.
- PM2 7.0.4 production starter and actual supervision/restart verification.
- MIT license, package metadata, Node 24 support and contribution/security policies.
- Coverage floors, separate dependency audits and exact-archive CI/release gates.

See MIGRATING.md for the new default, runtime range and manual template upgrades.

## [0.8.0] — 2026-09-07

### Changed

- Route scanning validates each HTTP method's first handler and rejects unsupported
  paths and ambiguous declarations. `ctx.routes.mount()` preserves nested prefixes.
- Shutdown drains active work before module hooks, shares one operation across
  repeated calls, removes signal listeners, and attempts all cleanup within a
  configurable graceful deadline. Failed boot releases acquired infrastructure.
- CLI route/spec inspection skips bootstrap, sockets, listeners and readiness hooks.
- `ConfigCtx`, `RuntimeCtx`, `BackendCtx`, `DatabaseCtx`, `requireModels` and
  `requireQueues` express phase and capability contracts. Scaffold and example use
  the more precise types.
- RAI `status` drives the default response status and generated OpenAPI success
  response. Custom authorization policies are reported as dynamic.

### Fixed

- Kebab-case module names no longer produce invalid generated configuration types.
- Queue-close failures no longer skip Redis teardown.
- Async access checks are awaited before validation and endpoint handlers; only
  boolean `true` grants access, and policy errors use the normal error handler.
- Guest authentication state is isolated per request in core, the reference app,
  and generated auth helpers.
- Duplicate method/URL templates fail route scanning even with different RAI IDs
  or parameter names, preventing ambiguous handlers and overwritten specifications.
- Forced database cleanup obeys the same shutdown deadline as graceful cleanup.

### Tests

- Vitest unit and integration suites, TypeScript contract checks, and Mongo/Redis
  service-backed CI checks cover the reliability contracts. See
  [testing instructions](../../docs/testing.md) in the repository.

Released alongside `@tulipes/spec@0.2.0`, which requires core `^0.8.0` and is
included in new CLI scaffolds.

See [migration steps](./MIGRATING.md#reliability-contracts-08) before upgrading.

## [0.7.1] — 2026-09-06

### Changed

- **The scaffold no longer commits `.envs/`.** The generated `.gitignore`
  excludes the whole directory, because those files hold working
  credentials — the dev file ships JWT secrets and an admin password. The
  committed contract is `.env.example`, generated by `yarn sync`, which
  names every variable any module declares; a clone copies from it. The
  generated env-file headers and README say so, where they previously said
  the opposite.
- The README leads with the project's logo rather than the ASCII banner.
  The image ships inside the package (`assets/`) and is referenced over
  jsDelivr, so it renders on npm as well as in the repository.

**Upgrading an existing app**: add `.envs/` to its `.gitignore`, then
`git rm -r --cached .envs` — the files stay on disk, but git stops
tracking them. Anything a deployment needs should already be in the
container environment, which outranks the file either way.

## [0.7.0] — 2026-09-06

### Added

- **`ctx.modules`** — every module's manifest in load order, with its
  resolved directory. The authoritative answer to "what modules does this
  app have?", which `config` cannot give: the app-level seed puts keys
  there that belong to no module.
- **The variable store records which source won** (`process.env`, the env
  file, or the declared default) and exposes `describe()` returning each
  variable's full spec, owner, source and value. Not recoverable
  afterwards, and anything writing a value back needs it.
- `Environment.envFile` — the file this run loaded, and therefore the one
  place a deployment-time value belongs.
- `coerceValue` is exported, so a value can be validated against a
  variable's declared type before it is written.
- **A `settings` module in the scaffold**: an infrastructure console
  reachable only by `sysadmin`. Describes every module (manifest,
  variables with full spec and resolved source, config, i18n, routes),
  edits variables and translations, restarts through PM2, and streams logs
  over SSE — tailing the log files, so it sees the worker as well as the
  backend. Every reveal, write and reboot is audited at `warn`, and a
  secret's value is never recorded in either direction.

### Changed

- The scaffold's auth module grants `admin` its namespaces **explicitly**
  rather than `*`, and adds a `sysadmin` role. A wildcard would reach
  `settings:*` like any other id, making the console's boundary a label
  rather than a rule. Existing apps are unaffected until they adopt the
  settings module — see [MIGRATING.md](./MIGRATING.md).

## [0.6.1] — 2026-09-06

### Fixed

- **Every command that boots the app was broken when `tulipes` is installed
  globally** — which is how `tulipes update` installs it. The CLI booted
  through its *own* `@tulipes/core`, giving the process two copies of
  mongoose, so every model failed its `instanceof Schema` check and the
  boot aborted with a report blaming the models. `tulipes routes` has had
  this since 0.3.0; `tulipes spec` inherited it. Both now boot through the
  app's own core, keeping mongoose and every other shared singleton to one
  copy.
- `tulipes spec` reported `@tulipes/spec` as missing even when it was
  installed, for the same reason: a global CLI resolved the import against
  its own `node_modules` rather than the app's.
- `tulipes update` now names the migration guide when it crosses minor
  versions, since each one below 1.0 may carry breaking changes.

## [0.6.0] — 2026-09-06

### Added

- **Request validation on the RAI.** `rai({ body, query, params })` takes
  zod schemas; the framework parses each segment, writes the coerced values
  back, and reports failures as the envelope's `errors[]` with no handler
  code. All three segments are checked before answering, so a request wrong
  in two places says so once.
- The zod message doubles as an i18n key, so a rejected field arrives in
  the caller's language; the code comes from zod's issue code
  (`INVALID_FORMAT`, `TOO_SMALL`).
- `returns` on the RAI — never validated, it describes the response for
  generated documents.
- `folder` on the RAI — the Postman folder and OpenAPI tag for an endpoint,
  defaulting to the declaring module.
- `tulipes spec`, writing an OpenAPI 3.1 document and/or a Postman
  collection. The generator lives in the new
  [`@tulipes/spec`](https://www.npmjs.com/package/@tulipes/spec) package,
  imported lazily so core carries no dependency on it.

### Changed

- Validation runs **after** the access check, never before: telling a caller
  which fields are wrong on a route they may not reach would leak its shape.

## [0.5.2] — 2026-09-06

### Added

- A [CHANGELOG](./CHANGELOG.md) and a [migration guide](./MIGRATING.md),
  both shipped in the package. The `0.2 → 0.5` chain broke four times and
  had no written upgrade path.

### Removed

- `api.docsPath` from the scaffold's `config/app.config.ts`. It was
  declared in every generated app and read by nothing; the RAI registry is
  where a docs endpoint will come from when one exists.

## [0.5.1] — 2026-09-06

### Fixed

- **`tulipes init` shipped a users module that was a one-route stub** while
  the reference app ran a full one. The scaffold now carries the same
  config, environment contract, ACL, queue, socket and seven endpoints, and
  CI diffs `tulipes init` output against the example so they cannot drift
  again.
- Registration failed on a fresh app's first boot: `USERS_SIGNUP_MODE` was
  never written to the generated `.envs/.env.development`, so
  `POST /auth/register` answered "registration is closed". It now ships as
  `open`.

### Removed

- `JWT_SECRET` from the core module's variables. It was declared
  **required**, so every deployment had to supply it, and nothing read it —
  the auth module owns `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`.
- `USERS_ADMIN_EMAIL`, likewise dead: auth seeds the admin from
  `AUTH_ADMIN_EMAIL`.

## [0.5.0] — 2026-09-06

### Added

- **One response envelope.** Every endpoint answers
  `{ success, data, errors, meta }`, built by `res.respond`. Express is
  untouched — `res.json`, `res.send` and `res.status` behave exactly as
  before — so `respond` is a method you call, never a wrapper you fight.
- **Error codes and field attribution.** `errors[]` carries
  `{ field, message, code }`. The thrown message is an i18n key: it is
  translated in the module's namespace (the one the route's RAI recorded)
  and the code derives from it, so `notFound` becomes `NOT_FOUND`. An
  already-translated string still passes through, since a string that
  resolves to no key was never a key.
- `ValidationError`, for reporting several field errors in one response.
- **`req.page`** — `?page` and `?per_page`, clamped by `config.pagination`.
  Passing `total_items` to `respond` is what marks a response as a page and
  fills in `total_pages`.
- A development-only warning naming any route that answered without
  `res.respond`. It observes; it never intercepts.
- `req.hasTranslation(key)`.

### Changed

- **Persisted and wire field names are `snake_case`** — `created_at`,
  `last_seen_at`, `password_hash`, `access_token`. camelCase remains for
  TypeScript-only names.
- `HttpError`'s third argument is an options object
  (`{ field, code, defaultMessage, vars, details }`) rather than bare
  details.

### Fixed

- `resolve()` called `req.t()` on messages that were already translated, and
  i18next records an unknown lookup as a missing key — so English prose was
  being written into `modules/*/i18n/*.missing.json`, filling a translator's
  work list with sentences it must never contain.
- The `.missing.json` gitignore pattern was anchored at the repository root
  and never matched a nested app's files.

## [0.4.0] — 2026-09-05

### Added

- **`req.auth`** — `{ isAuthenticated, user, session }`, resolved before any
  feature route and never undefined inside a declared one. `AuthUser` and
  `AuthSession` are empty interfaces core never fills: it knows the shape of
  the contract, the app's auth module says what is in it.
- The scaffold's auth module keeps `Session` rows that survive refresh
  rotation, so an account can list and end its own devices
  (`GET /auth/sessions`, `DELETE /auth/sessions/:sid`). Both tokens of a
  pair carry an `sid` claim, which is what lets an access token find its own
  session row after the refresh jti has rotated out from under it.

### Changed

- The ACL reads the caller's role through `req.auth.user`. An app whose
  roles live elsewhere overrides the decision with
  `ctx.routes.setAccessChecker()` rather than faking a user.
- Refresh rotation is a conditional atomic update on the jti still current
  on the session row, so a replay — or the loser of a race — matches
  nothing.

### Removed

- `req.principal`, the `Principal` type and the `principal()` helper.

## [0.3.0] — 2026-09-05

### Added

- **RAI — Resource Access Identifier.** Every route declares
  `rai({ id, name?, description? })`. The `id` names a resource and an
  access to it, and **is** the ACL permission, so one declaration identifies
  the endpoint, gates it, and marks it as declared.
- **A boot-time router-stack scan.** A route with no RAI, or two routes
  sharing an id, aborts the boot. This exists because the pipeline
  authenticates rather than rejects: an undeclared route is not merely
  undocumented, it is reachable by `guest`.
- `tulipes routes`, listing every declared endpoint with the roles that
  reach it.
- **Per-module i18n.** A module is an i18next namespace; `req.t` inside a
  handler is already bound to the module that declared the route. Locale is
  `?lang`, then `Accept-Language`, then `config.i18n.defaultLocale`, each
  narrowed to `supportedLocales`. `ctx.t(ns, locale)` covers code with no
  request to negotiate from.
- Invalid JSON in a locale file, or an `i18n/` folder with no
  default-locale file, aborts the boot. Outside production, every gap
  against the default locale is written to `<locale>.missing.json`.

### Changed

- Controllers are classes taking `ctx` in the constructor, whose methods
  return handlers.

### Removed

- `requirePermission` and `requireAuth`. A route's `rai({ id })` is the
  permission check.

## [0.2.0] — 2026-09-02

### Added

- A JWT auth module in the scaffold: passport, access and refresh tokens
  with rotation and blacklisting, and a `Credential` model so no secret ever
  touches the user document.
- A `guest` role, which is what makes a public endpoint an ordinary ACL
  grant rather than a second mechanism.

## [0.1.x] — 2026-08-29 … 2026-08-31

Initial development series: the boot pipeline and its aggregate
`BootReport`, environment contracts from `meta.variables.json`, the module
graph (`tier` / `priority` / `dependsOn`), global and per-module config with
generated types, ACL, the model store, queues, sockets, the three process
modes (`backend`, `worker`, `script`), the startup banner, and the CLI —
`init`, `dev`, `sync`, `env:check`, `new module`, `update`.

[0.11.0-rc.1]: https://github.com/kemora13conf/bp-backend-express/compare/v0.10.1...v0.11.0-rc.1
[0.9.0-rc.3]: https://github.com/kemora13conf/bp-backend-express/compare/v0.9.0-rc.2...v0.9.0-rc.3
[0.9.0-rc.2]: https://github.com/kemora13conf/bp-backend-express/compare/v0.9.0-rc.1...v0.9.0-rc.2
[0.9.0-rc.1]: https://github.com/kemora13conf/bp-backend-express/compare/v0.8.0...v0.9.0-rc.1
[0.8.0]: https://github.com/kemora13conf/bp-backend-express/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/kemora13conf/bp-backend-express/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/kemora13conf/bp-backend-express/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/kemora13conf/bp-backend-express/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/kemora13conf/bp-backend-express/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/kemora13conf/bp-backend-express/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/kemora13conf/bp-backend-express/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/kemora13conf/bp-backend-express/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/kemora13conf/bp-backend-express/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/kemora13conf/bp-backend-express/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kemora13conf/bp-backend-express/compare/v0.1.14...v0.2.0
