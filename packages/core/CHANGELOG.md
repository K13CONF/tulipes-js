# Changelog

All notable changes to `@tulipes/core`.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the major version is `0`, a minor bump may carry breaking changes —
`0.2 → 0.5` each did. Upgrading across any of them needs the notes in
[MIGRATING.md](./MIGRATING.md).

## [Unreleased]

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

[Unreleased]: https://github.com/kemora13conf/bp-backend-express/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/kemora13conf/bp-backend-express/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/kemora13conf/bp-backend-express/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/kemora13conf/bp-backend-express/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/kemora13conf/bp-backend-express/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/kemora13conf/bp-backend-express/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/kemora13conf/bp-backend-express/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kemora13conf/bp-backend-express/compare/v0.1.14...v0.2.0
