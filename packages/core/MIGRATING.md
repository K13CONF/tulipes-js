# Migrating

Every `0.x` minor from `0.2` to `0.5` carried breaking changes. They are
listed here newest-first, but an upgrade should be read **oldest-first**
from wherever you are: the steps compose, and the data migration in 0.5 is
the only one that can lock users out of an application.

Run `tulipes update` to move the global CLI and every module manifest at
once; it reinstalls the CLI into the prefix it already lives in, which is
what makes it work under nvm.

---

## Reliability contracts (unreleased)

These changes tighten route registration and alter shutdown timing. Release them
in the next minor version; existing 0.7 applications should follow these steps.

1. Put exactly one `rai()` first in each endpoint's method chain. For a chained
   route, give GET and POST separate declarations with distinct IDs. Replace
   `route.all()` with explicit supported HTTP methods. Literal paths and named
   `:parameters` are supported; regex, array, optional and wildcard paths now fail
   boot rather than producing an incomplete specification.
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
   in `boot()` if needed. A timeout rejects shutdown and later cleanup is attempted.
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
