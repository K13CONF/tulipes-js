# Migrating

Every `0.x` minor from `0.2` to `0.5` carried breaking changes. They are
listed here newest-first, but an upgrade should be read **oldest-first**
from wherever you are: the steps compose, and the data migration in 0.5 is
the only one that can lock users out of an application.

Run `tulipes update` to move the global CLI and every module manifest at
once; it reinstalls the CLI into the prefix it already lives in, which is
what makes it work under nvm.

---

## Unreleased — refresh reuse expires the device family

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
and open log streams are not cancelled by this update. Real replica-set failover,
client coordination and incident alerting remain deployment follow-ups.

## Unreleased — browser authentication guidance

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

## Unreleased — restart acknowledgment before execution

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

## Unreleased — bounded log streaming

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

Authorization is checked on opening. Existing streams do not continuously recheck
role changes, credential replacement or revocation; the lifetime/expiry limit
bounds their remaining exposure. Immediate stream revocation remains follow-up
policy work. The framework drains HTTP before module shutdown hooks: a stream
still open at its shutdown deadline is force-closed by the existing HTTP cleanup
and that timeout is reported. Gracefully signaling streams before HTTP drain is
recorded separately in the sprint backlog. See [Node response backpressure and close events](https://nodejs.org/docs/latest-v24.x/api/http.html).

## Unreleased — constrained settings file access

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
files instead of this console. Log files/streaming are a separate S08 increment.

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

## Unreleased — shared production request limits

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
writes. Edge traffic limits, account-aware abuse response, deployment/load tuning
and concurrent/open-stream bounds remain separate work.

## Unreleased — explicit production proxy trust

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

## Unreleased — durable production settings audits

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

## Unreleased — credential-bound production sessions

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

## Unreleased — production session validity

Refresh the editable `modules/auth/helpers/tokens.ts` and `passport.ts` from the
updated starter. `loadSession` now requires the token subject as its third argument.
Access and refresh reject expired sessions even before MongoDB TTL cleanup and
require the stored session owner to match that subject. Session listings exclude
expired rows. Apply the credential-version upgrade above alongside these checks.

## Unreleased — production settings restart scope

Refresh the editable `modules/settings/helpers/pm2.ts` from the updated production
starter. Reboot targets must belong to the installed application's canonical PM2
working directory; an empty list selects only those processes. Mixed valid and
invalid names now fail with 400 before any restart. A daemon without verified
processes for this app returns 503. Keep PM2 `cwd` set to the application root.
The helper restarts numeric IDs to avoid name collisions across applications.

## Unreleased — offline inspection with native routers

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
observe them. See [offline inspection](../../docs/offline-inspection.md) for the
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

This release does not extract provider dependencies or add general offline
inspection. The candidate versions are core 0.9.0-rc.2 and spec 0.3.0-rc.2, published under
`next`. Install the candidate CLI with `npm install -g @tulipes/core@next`;
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
