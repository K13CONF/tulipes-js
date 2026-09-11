# Changelog

## Unreleased

- Add optional `onDrain` module hooks at the start of shutdown, sharing the traffic
  drain deadline and aggregate cleanup errors. Production settings use the hook
  to stop log streams, reject late openings and abort pending authorization before
  resource disposal; a subsequent boot gets fresh stream admission.

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


All notable changes to `@tulipes/core`.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the major version is `0`, a minor bump may carry breaking changes —
`0.2 → 0.5` each did. Upgrading across any of them needs the notes in
[MIGRATING.md](./MIGRATING.md).

## [Unreleased]

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

[Unreleased]: https://github.com/kemora13conf/bp-backend-express/compare/v0.9.0-rc.2...HEAD
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
