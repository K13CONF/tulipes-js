# Plan — client headers on every request

Status: planned on 2026-11-01 against `d099209` (master after PR #41). Nothing implemented.

The brief: port the "client headers" feature of another project (a legacy
Express app) into every Tulipes app — the reference app in `example/`, which
`tulipes init --preset production` copies, and the committed minimal preset
under `packages/cli/templates/minimal`. Every client sends a fixed set of
headers; one middleware reads, validates and defaults them, and the result is
on the request for handlers and logs, with the request id echoed back.

Section 1 maps the brief onto what Tulipes already does, section 2 is the
design, section 3 the sprint items with acceptance criteria, section 4 the
evidence to collect, section 5 the decisions taken and section 6 the backlog.

## 1. What already exists (do not rebuild)

| Brief | Tulipes today | Consequence |
|---|---|---|
| `accept-language` → `language`, resolved after i18n, base code, narrowed to a list | Core: `req.locale`, `req.t` bound by `rai()` from `?lang`, `Accept-Language` (q-values), narrowed to `config.i18n.supportedLocales` (`packages/core/src/i18n/locale.ts`) | **Not part of this feature.** The guide points at `req.locale`. |
| `x-timezone` → `timezone`, IANA-validated, default `UTC` | Core: `req.timezone`, `req.time` bound by `rai()` from `?tz`, `X-Timezone`, canonical IANA, optional `config.timezone.supported` (`packages/core/src/time/timezone.ts`) | **Not part of this feature.** Core already accepts case-insensitive zones and falls back to the default. |
| Request id generated, echoed as `X-Request-Id` | `example/modules/core/routes/core.routes.ts` sets a fresh uuid on every response; `security.routes.ts` feeds it to pino-http as the log line's `reqId` | Keep the slot; add the round-trip (a valid client id is kept). |
| Global middleware slot "after cors and i18n, before routes" | Core mounts nothing. The sys `core` module loads first (priority 0), so `ctx.app.use(...)` in its routes file runs before every module. `security` (helmet, cors, pino-http, body parser) depends on `@app/core`, so it loads **after** core. | The parser lives in the core module. Preflight `OPTIONS` reaches it before cors: see §2.4. |
| CORS reflects requested headers | `corsOptions()` sets no `allowedHeaders`, so the `cors` package reflects `Access-Control-Request-Headers`. No `exposedHeaders`. | Add `exposedHeaders: ["X-Request-Id"]` only. |
| Required-header 400 with a translated message | `HttpError(status, message, { code, defaultMessage, details })`; the terminal handler translates a key with `req.t` when bound, else uses `defaultMessage` | `defaultMessage` + `code`, no i18n file: the parser runs before `rai()` binds `req.t`. |
| Audit log stores the client context | `modules/config` writes `ConfigAudit` rows (`ip`, actor, keys; `strict: "throw"`) | Add `request_id` to that row. No general request log model exists; none is added. |
| Console print of the headers on `finish` | pino-http already logs one line per request with `reqId` | Put the client fields in the `req` serializer instead of a second printer. |
| Minimal preset | `modules/core` has no routes file; `security` mounts helmet and the body parser, no cors, no pino | Gets the same helper and a two-line core routes file; nothing else. |

## 2. Design

### 2.1 The headers

| Header | Accepted | Normalized | Default | `req.client.` |
|---|---|---|---|---|
| `x-platform` | `web`, `android`, `ios` | lower-cased | `web` | `platform` |
| `x-app-version` | `^\d+(\.\d+){0,2}([-+][0-9A-Za-z.-]+)*$` | as-is | `null` | `appVersion` |
| `x-app-mode` | `development`, `staging`, `production` | lower-cased | `production` | `appMode` |
| `x-device-id` | `^[0-9A-Za-z._-]{8,128}$` | as-is | `null` | `deviceId` |
| `x-request-id` | same id pattern | as-is | `crypto.randomUUID()` | `requestId` |

Values are trimmed; empty is missing; missing or invalid → default. Only a
*missing required* header fails the request (400, every missing name at
once); today no header is required. Header names are case-insensitive
(`req.get()`). `accept-language` and `x-timezone` stay with core (§1).

### 2.2 Shape and placement (both presets)

```
modules/core/helpers/client-headers.ts   definitions + pure parser + middleware
modules/core/routes/core.routes.ts       mounts it (replaces the bare randomUUID line)
modules/core/lib/index.ts                re-exports CLIENT_HEADERS, ClientHeaders (example only; @app/core's public surface)
```

The definitions are one data object, so adding a header is a data edit:

```ts
export const CLIENT_HEADERS = {
  platform:   { header: "x-platform",    values: ["web", "android", "ios"], default: "web" },
  appVersion: { header: "x-app-version", pattern: VERSION, default: null },
  appMode:    { header: "x-app-mode",    values: ["development", "staging", "production"], default: "production" },
  deviceId:   { header: "x-device-id",   pattern: ID, default: null },
  requestId:  { header: "x-request-id",  pattern: ID, default: null },   // null → generated
} as const;
```

`required: true` on an entry turns on the 400. A `values` entry lower-cases
before comparing; a `pattern` entry keeps the value as sent. `example` is
dropped: the Postman collection is generated from route schemas, not from
this table (backlog item for adding the headers to it).

The middleware: `readClientHeaders(get: (name) => string | undefined)` is a
pure function returning `{ client, missing }`, tested without a boot; the
handler wraps it:

```ts
export function clientHeaders(): RequestHandler {
  return (req, res, next) => {
    const { client, missing } = readClientHeaders((name) => req.get(name));
    if (missing.length) {
      return next(new HttpError(400, "clientHeadersRequired", {
        code: "CLIENT_HEADERS_REQUIRED",
        defaultMessage: `Missing required headers: ${missing.join(", ")}`,
        details: { headers: missing },
      }));
    }
    req.client = client;
    res.setHeader("X-Request-Id", client.requestId);
    next();
  };
}

declare global { namespace Express { interface Request { client: ClientHeaders } } }
```

`req.client` is typed non-optional the way core types `req.auth`: the core
module mounts it before every route, so inside a handler it is always set.

### 2.3 Consumers

1. **pino-http** (`security.routes.ts`): `genReqId` is unchanged (it reads
   the header the core module set, now the client's id when valid). The
   `req` serializer adds `platform`, `appVersion`, `appMode`, `deviceId` from
   `req.client`, so a log line can be filtered by any of them.
2. **Config audit** (`modules/config/helpers/audit.ts`, `config-audit.model.ts`):
   `request_id: String` on the row, filled from `req.client.requestId`.
   Snake_case because it is persisted (project rule). No index until a
   reader exists (backlog).
3. **Handlers**: `req.client.platform` / `.appVersion` for force-update
   checks and the like; shown in the guide with one example, not added to
   any existing endpoint.
4. **Clients**: the error envelope's caller shows `X-Request-Id` in support
   messages. Documented as the client contract (§2.5).

### 2.4 Pipeline order and preflight

```
core      clientHeaders()           ← this feature (sys, priority 0)
security  helmet, cors, pino-http, rate limits, express.json
<every other module's router>
core      notFoundHandler, errorHandler
```

The core module cannot run after cors without moving the parser into the
security module. It stays in core because the parser must not depend on a
module that depends on it, and because a required header would then be
checked on a preflight: `clientHeaders()` therefore skips `OPTIONS` requests
(`req.method === "OPTIONS"` → `next()` without reading anything). With no
header required (the default) the question does not arise.

Static files and the health route go through the parser too; it never
fails without a required header, and reading five headers costs nothing.
Socket.IO connections are not covered (HTTP middleware only), as in the
original.

### 2.5 Client contract (documented, not code)

```js
api.interceptors.request.use((r) => {
  r.headers["x-platform"] = "web";                  // android | ios on mobile
  r.headers["x-app-version"] = APP_VERSION;         // 1.4.2, 1.4.2+37, 1.4.2-beta.1
  r.headers["x-app-mode"] = APP_MODE;               // development | staging | production
  r.headers["x-device-id"] = installId;             // mobile only, stable per install
  r.headers["x-request-id"] = crypto.randomUUID();  // new per request
  r.headers["x-timezone"] = Intl.DateTimeFormat().resolvedOptions().timeZone;  // read by core
  r.headers["accept-language"] = currentLanguage;   // read by core
  return r;
});
```

### 2.6 What this does **not** touch

- `packages/core`: no new middleware, no new dependency. Core's rule that it
  mounts nothing globally stands; this is app code in a sys module.
- `config.i18n` / `config.timezone` and their request bindings.
- The rate limiter, helmet, the body parser, the ACL.

## 3. Sprint items

### C01 — the parser in the reference app

Files: `example/modules/core/helpers/client-headers.ts` (new),
`example/modules/core/routes/core.routes.ts`, `example/modules/core/lib/index.ts`,
`example/modules/security/helpers/hardening.ts` (`exposedHeaders`),
`example/modules/security/routes/security.routes.ts` (serializer),
`example/modules/config/helpers/audit.ts` and `models/config-audit.model.ts`.

Accept:
- `pnpm typecheck` passes; `req.client` is typed in every example handler.
- `tulipes routes` and `tulipes spec` still work under inspection: the
  handler reads no environment value, so it is mounted directly, not through
  `lazy()` (the cache middleware beside it keeps `lazy()`).
- `corsOptions()` returns `exposedHeaders: ["X-Request-Id"]` in both branches.
- A config change writes `request_id` on its audit row.

### C02 — tests (port of the original's acceptance table)

`example/modules/core/tests/client-headers.test.ts`, booted with
`useTestApp` like `security.test.ts`, against `GET /api/v1/hello`:

| # | Request | Expect |
|---|---|---|
| 1 | `X-Platform: Android`, `X-App-Version: 1.4.2+37`, `X-App-Mode: staging`, `X-Device-Id: b3c1f9a2-0d4e-4c8a-9f1e-2a7b5c6d8e90`, `X-Request-Id: req-12345678` | response header `x-request-id: req-12345678`; the handler saw `{ platform: "android", appVersion: "1.4.2+37", appMode: "staging", deviceId: "b3c1…8e90", requestId: "req-12345678" }` |
| 2 | `X-Platform: windows`, `X-App-Version: latest`, `X-App-Mode: prod`, `X-Request-Id: bad id!` | 200; defaults `web`, `null`, `production`, `null`; `x-request-id` is a 36-character uuid |
| 3 | pure `readClientHeaders` with `platform.required = true` and no headers | `missing: ["x-platform"]`; with `x-platform: ios` → `missing: []` |
| 4 | `OPTIONS /api/v1/hello` with `Origin` and `Access-Control-Request-Headers: x-platform, x-request-id` | cors answers; `access-control-expose-headers` contains `X-Request-Id` |
| 5 | a settings change through `/api/v1/config/...` with `X-Request-Id: req-audit-1` | the `ConfigAudit` row has `request_id: "req-audit-1"` (extends `config.test.ts`) |

Row 1 needs the handler's view: the test reads it back from the pino line
or, simpler, asserts the pure parser on the same headers and the round-trip
on the live app. Pick the simpler one and say which in the tracker.

Accept: `pnpm test` with `TEST_MONGO_URI` and `TEST_REDIS_URL` passes, output
read; the new file's cases are listed in the tracker.

### C03 — the minimal preset

`packages/cli/templates/minimal/modules/core/helpers/client-headers.ts`
(same file as C01) and a new `modules/core/routes/core.routes.ts` that mounts
it. No cors, no pino, no audit in this preset, so nothing else changes.
`tests/app.test.ts` gains one test: a sent `X-Request-Id` comes back, a
missing one is generated.

Accept: `pnpm test` in `packages/cli` passes, including the scaffold-and-diff
test that proves `example/` renders faithfully (the production preset gets
C01 for free; CI diffs it).

### C04 — docs

- `site/src/content/docs/guides/client-headers.mdx` (sidebar order 13, after
  scripts): the five headers, what core already reads (`req.locale`,
  `req.timezone`), the pipeline position, the required-header 400, the log
  line, the audit field, the client contract, and how to add a header (one
  data edit, one test). Lint with `node site/scripts/lint-frontmatter.mjs`.
- Pages that copy `core.routes.ts` verbatim must match the new file:
  `guides/cache.mdx:143`, `guides/routes-and-controllers.mdx:470`,
  `guides/logging.mdx:168`, and the pipeline diagram in
  `guides/security-middleware.mdx:33`.
- `example/.claude/skills/tulipes-endpoint` (and its copy under
  `packages/cli/templates/.claude`): one line that `req.client` exists.
- `packages/core/MIGRATING.md`: an entry for the next CLI line — generated
  apps are the user's code, so the steps are "copy the helper, mount it in
  core.routes.ts, add `exposedHeaders`, the serializer fields and the audit
  field", with the file list, in the style of the 0.13 entry. No `tulipes
  migrate` script: the 0.13 pattern for app-owned modules is a file list.

Accept: `pnpm build` and `pnpm check` in `site/` pass; the guide reads as a
learning page, not a spec (the WRITING.md rules).

### C05 — release bookkeeping

Only `@tulipes/cli` ships new bytes (the templates). Per `docs/releasing.md`
that is one CLI version; core and the providers are untouched, so no cascade.
Record in the release note; publishing is a separate authorized step.

## 4. Evidence to collect

- Local: `pnpm typecheck`, `pnpm test` (with both service variables), the
  new test file's case list, `pnpm test` in `packages/cli`.
- Site: `pnpm build && pnpm check` in `site/`.
- Manual: `curl -i -H 'X-Request-Id: req-12345678' localhost:3000/api/v1/hello`
  shows the id echoed and the pino line carrying `reqId: "req-12345678"`
  with `platform: "web"`.
- CI: the scaffold diff job and the test job on the PR.

## 5. Decisions taken (change here if you disagree)

1. **Five headers, not seven.** Language and time zone are core's job and
   already behave as the brief asks; duplicating them on `req.client` would
   give two sources of truth. The guide shows all seven from the client's
   side.
2. **`req.client`, not `req.context.client`.** Tulipes puts request-scoped
   facts flat on `req` (`req.auth`, `req.locale`, `req.timezone`, `req.page`).
   No `req.timezone`/`req.requestId` aliases are needed: the first exists,
   the second is `req.client.requestId`.
3. **Definitions as a constant in the helper, not settings.** The minimal
   preset has no settings store, and the lists change with a release of the
   client apps, not at runtime. Backlog if a console-editable list is wanted.
4. **No i18n key.** The parser runs before any route binds `req.t`;
   `defaultMessage` + `code` is what the terminal handler is built for.
5. **In the core module, skipping `OPTIONS`.** The only way to run after
   cors is to live in the security module; that would make a required-header
   check depend on the module that depends on core. Skipping preflight has
   the same effect.
6. **Audit row gets `request_id`; no new log collection.** The brief's "logs"
   consumer is a request-log model the reference app does not have. The pino
   JSON files are the request log here, and they already carry the id.

## 6. Backlog (not in this sprint)

- A console-editable allow-list (platforms, app modes) as core module
  settings, read live by the parser.
- `request_id` index on `config_audit_events` once a reader filters by it.
- Add the client headers to the generated Postman collection and OpenAPI
  (`@tulipes/spec` has no header-parameter concept today).
- A force-update endpoint or helper comparing `req.client.appVersion`
  against a minimum per platform (settings) — the brief's "force-update
  checks" consumer.
- Socket.IO handshake: read the same headers from `socket.handshake.headers`
  into `socket.data.client`.
