---
name: tulipes-permissions
description: Use when adding roles or permissions to a Tulipes app, guarding an endpoint by role, making a route public, or deciding who may do what. Covers module.acl.ts, the guest role, and module-namespaced resources.
---

# Adding permissions

Roles are **global** and defined once by the sys `auth` module. Every other
module **grants** permissions on its own resources to those roles.

`modules/auth/module.acl.ts` — the vocabulary:

```ts
export default function authAcl(acl: AclBuilder): void {
  acl.defineRole("guest").defineRole("user").defineRole("admin");
  acl.allow("guest", "auth:login", "auth:register", "auth:refresh");
  acl.allow("admin", "*");
}
```

`modules/billing/module.acl.ts` — grants for this feature:

```ts
export default function billingAcl(acl: AclBuilder): void {
  acl.allow("user", "invoices:read");
}
```

Guard a route with the permission it needs:

```ts
import { requirePermission } from "@app/auth";

const may = (permission: string) => requirePermission(ctx, permission);
router.get(`${base}/invoices`, may("invoices:read"), handler);
```

## Public routes are grants, not exceptions

A request with no valid token is not rejected — it becomes the **`guest`**
principal. So "public" means guest holds the permission:

```ts
acl.allow("guest", "docs:read");   // now anyone may read the docs
```

There is no allowlist, no `skipAuth` flag, no second mechanism. Access is
decided in one place, and the whole policy is readable by reading the
`module.acl.ts` files.

**The corollary matters: a route with no permission check is public.**
Because the pipeline authenticates rather than rejects, forgetting a guard
does not fail closed — it silently exposes the route. Name a permission on
every route, even ones you expect everybody to reach.

## Rules

- **Resources are namespaced by module**: `invoices:read`, `users:write`.
  Match the module's short name so ownership is obvious.
- **Grant, don't define.** A feature module calling `defineRole()` usually
  means the role belongs in `auth`. `allow()` on an unknown role is a boot
  error, never an implicit creation.
- The same role+resource granted twice crashes the boot.
- Wildcards: `*` (everything), `invoices:*` (a namespace). Give `*` to
  `admin` only.
- Unknown roles always deny at runtime.

## Denials

`requirePermission` answers 401 when the caller is a guest (signing in
would help) and 403 when they are authenticated but lack the grant (it
would not). `requireAuth` is the guard for routes that only care that
somebody is signed in, like `/me`.

## Gotchas

- Load order: roles must exist before grants, which is why `auth` is
  `tier: "sys", priority: 20`. A module granting on those roles is app-tier
  and therefore loads later; if you make one sys-tier, give it a higher
  priority than auth or it will crash with "unknown role".
- `acl.can()` answers *what a role may do*, not *who the caller is*.
  Resolving the caller is the auth module's job.
- Roles are lowercase kebab-case; resources are `name:action`.
