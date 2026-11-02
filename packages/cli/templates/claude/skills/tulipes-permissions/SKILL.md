---
name: tulipes-permissions
description: Use when adding roles or permissions to a Tulipes app, naming a RAI id, guarding an endpoint by role, making a route public, choosing a scope (bo, web, mobile), or deciding who may do what. Covers the module:scope:resource[:extra] format, module.acl.ts, wildcards, role descriptions and extras, and the guest role.
---

# Adding permissions

## The RAI format

Every route and every agent action declares a RAI id, and that id **is**
the permission. It always has this shape:

```
{module}:{scope}:{resource}[:{extra}]
```

| Segment | Required | What it is | Examples |
|---|---|---|---|
| module | yes | the declaring module's name, as its folder spells it | `users`, `user-profiles` |
| scope | yes | the surface the endpoint serves | `bo`, `web`, `mobile` |
| resource | yes | what is reached | `list`, `detail`, `profile` |
| extra | no | a variant or sub-action of the resource | `delete`, `deleted`, `by-name` |

```
users:bo:list              the back office lists users
users:mobile:profile       the mobile app reads the caller's profile
users:bo:detail            the back office reads one user
users:bo:detail:delete     ...and deletes it
```

Each segment is lowercase, starts with a letter, and may hold digits and
hyphens. `users:read` (no scope), `Users:bo:list` and a fifth segment are
refused: in the editor, because `id` is typed, and at boot with the route
and module named.

Scopes are the app's own vocabulary. This app uses `web` for what a
signed-in client calls and `bo` for the back office; add `mobile` the day
a mobile client needs endpoints of its own. Nothing declares a scope
first. Keep the list short and spell it the same everywhere, because
`tulipes routes --scope bo` and `tulipes spec --scope mobile` filter on it.

## Roles are defined once, with what they mean

Roles are **global** and defined by the `auth` module. A definition can
carry a description and any other property the app wants to read back:

```ts
// modules/auth/module.acl.ts
declare module "@tulipes/core/acl" {
  interface RoleMeta { level?: number }   // types the extra everywhere
}

export default function authAcl(acl: AclBuilder): void {
  acl
    .defineRole("guest", { description: "Any request without a valid token", level: 0 })
    .defineRole("user", { description: "A signed-in account", level: 1 })
    .defineRole("admin", { description: "Runs the back office", level: 2 });

  acl.allow("guest", "auth:web:login", "auth:web:register", "auth:web:refresh");
}
```

Read a role back anywhere with `ctx.acl.role("admin")`: it returns
`{ name, definedBy, description, level }`, frozen. `ctx.acl.describeRoles()`
lists them all. `pnpm tulipes roles` prints each role with its
description, extras and every grant it holds, and the OpenAPI document
lists them under `x-tulipes-roles`.

`RoleMeta` is optional. Undeclared extras are accepted and returned as
`unknown`; declaring them is what types them and catches
`level: "high"` in the editor.

## Every other module grants on its own ids

```ts
// modules/billing/module.acl.ts
export default function billingAcl(acl: AclBuilder): void {
  acl.allow("user", "billing:web:invoices", "billing:web:invoices:download");
  acl.allow("admin", "billing:bo:*");
}
```

Guarding is the route's RAI, so there is no second call to forget:

```ts
router.get("/invoices", rai({ id: "billing:web:invoices", name: "List my invoices" }), billing.list());
```

The boot enforces this. A module may grant only ids that start with its
own name; another module's ids, or `*`, may be granted only by the module
that defined the role (the auth module, in this app). Anything else
refuses the boot:

```
✖ [billing] grants "guest" "users:*", an id of module "users" — a module grants its own ids ("billing:…"); grants on another module's ids belong in "auth", which defines "guest"
```

So a cross-module grant, like adding `billing:*` to `admin`, goes in
`modules/auth/module.acl.ts`.

## Wildcards

A grant is an exact id, `*`, or a prefix ending in `:*`. A prefix covers
everything under it, **the bare resource included**:

| Grant | Covers |
|---|---|
| `billing:bo:invoices:*` | `billing:bo:invoices`, `billing:bo:invoices:refund`, … |
| `billing:bo:*` | every billing permission in the back office |
| `billing:*` | every billing permission, any scope |
| `*` | everything. Give it to nobody but a true superuser. |

A scope across modules (`*:bo:*`) is not a grant: each module grants its
own ids, so the whole policy is readable module by module.

## Public routes are grants, not exceptions

A request with no valid token is not rejected. It becomes the **`guest`**
caller, so "public" means guest holds the permission:

```ts
acl.allow("guest", "docs:web:read");   // now anyone may read the docs
```

There is no allowlist, no `skipAuth` flag, no second mechanism. Access is
decided in one place, and the whole policy is readable by reading the
`module.acl.ts` files.

**The corollary matters: a route with no permission check is public.**
Because the pipeline authenticates rather than rejects, forgetting a guard
does not fail closed. It silently exposes the route. Name a permission on
every route, even ones you expect everybody to reach.

## Files follow the scope (a convention)

Name routes and controllers scope-first, so a module's surfaces read off
its folder. Core does not check this; it reads every `*.routes.ts` under
`routes/`, at any depth.

```
modules/users/
  routes/web.users.routes.ts            users:web:*
  routes/bo.users.routes.ts             users:bo:*
  routes/bo.users.passwords.routes.ts   a second bo file: the extra slot
  controllers/web.users.controllers.ts  export class WebUsersController
  controllers/bo.users.controllers.ts   export class BoUsersController

modules/hello/                          several files in one scope: a folder
  routes/web/hello.routes.ts
  routes/web/hello.greetings.routes.ts
  controllers/web/hello.greetings.controllers.ts   HelloGreetingsController
```

`tulipes new module billing --scope bo` scaffolds the flat form.

## Who is calling

`req.auth` is resolved before any feature route runs, and is never
undefined inside a declared route:

```ts
const { isAuthenticated, user, session } = req.auth;
user?.email          // the hydrated user document, or null for a guest
session?.sid         // this device's session row, or null
session?.accessJti   // the token in hand, for revoking exactly it
```

The route's own declaration is `req.rai`, and `parseRai` splits its id:

```ts
import { parseRai } from "@tulipes/core/http";
const { scope } = parseRai(req.rai!.id);   // "bo"
```

Never re-parse the Authorization header or trust a claim out of a token.
The pipeline already resolved both, and reloads the user on every request
so a demotion takes effect immediately.

A route that only cares that somebody is signed in still declares a RAI
and grants it to `user`; there is no separate "just needs auth" guard.

## Scopes: a credential that reaches less

A credential may carry `req.auth.scopes`: grant patterns in the same
grammar as `acl.allow()` (`hello:web:*`, `users:bo:list`, `*`). A request
is allowed when the role grants the permission **and** a scope covers it,
over a route and over an action alike, and `ctx.agent.manifest(actor)`
lists only those tools. A scope the role lacks grants nothing; `[]`
reaches nothing; no `scopes` is the role's full grant. Scopes are read from
the stored credential, never from the client.

The production preset's API tokens are where scopes come from: a signed-in
user issues one with `POST /auth/tokens { name, scopes?, expires_in_days? }`
(the secret is returned once), lists them with `GET /auth/tokens` and
revokes one with `DELETE /auth/tokens/:token_id`. Issue the narrowest
scope the task needs — `hello:web:*` for an agent that greets. A token
cannot issue tokens, and a password change retires every token.

## Denials

The RAI answers 401 when the caller is a guest (signing in would help) and
403 when they are authenticated but lack the grant (it would not). A
scoped credential whose role holds the grant but whose scopes do not
cover it gets 403 `OUT_OF_SCOPE`, so a client can tell the two apart.

## Gotchas

- **Grant, don't define.** A feature module calling `defineRole()` usually
  means the role belongs in `auth`. `allow()` on an unknown role is a boot
  error, never an implicit creation.
- The same role+resource granted twice crashes the boot.
- Load order: roles must exist before grants, which is why `auth` is
  `tier: "sys", priority: 20`. A module granting on those roles is app-tier
  and therefore loads later; if you make one sys-tier, give it a higher
  priority than auth or it will crash with "unknown role".
- `acl.can(role, id)` answers *what a role may do*; `acl.rolesFor(id)`
  answers *who may do this*. Neither says who the caller is. Resolving the
  caller is the auth module's job: it sets `req.auth`.
- The role core checks is `req.auth.user.role`. An app whose roles live
  elsewhere replaces the decision with `ctx.routes.setAccessChecker()`
  rather than inventing a fake user.
- Unknown roles always deny at runtime.
- Roles are lowercase kebab-case. `name` and `definedBy` are set by the
  ACL and cannot be part of a definition.
