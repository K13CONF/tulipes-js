# Migrating

Every `0.x` minor from `0.2` to `0.5` carried breaking changes. They are
listed here newest-first, but an upgrade should be read **oldest-first**
from wherever you are: the steps compose, and the data migration in 0.5 is
the only one that can lock users out of an application.

Run `tulipes update` to move the global CLI and every module manifest at
once; it reinstalls the CLI into the prefix it already lives in, which is
what makes it work under nvm.

---

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
