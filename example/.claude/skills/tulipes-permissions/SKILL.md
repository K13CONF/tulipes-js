---
name: tulipes-permissions
description: Use when adding roles or permissions to a Tulipes app, guarding an endpoint by role, or deciding who may do what. Covers module.acl.ts, the global role vocabulary and module-namespaced resources.
---

# Adding permissions

Roles are **global**, declared once by the sys `core` module. Every other
module **grants** permissions on its own resources to those roles.

`modules/core/module.acl.ts` — the vocabulary:

```ts
import type { AclBuilder } from "@tulipes/core/acl";

export default function coreAcl(acl: AclBuilder): void {
  acl.defineRole("admin").defineRole("user");
  acl.allow("admin", "*");
}
```

`modules/billing/module.acl.ts` — grants for this feature:

```ts
import type { AclBuilder } from "@tulipes/core/acl";

export default function billingAcl(acl: AclBuilder): void {
  acl.allow("user", "invoices:read");
  acl.allow("accountant", "invoices:read", "invoices:write");
}
```

Check at the edge of a handler:

```ts
if (!acl!.can(role, "invoices:write")) throw new HttpError(403, "forbidden");
```

## Rules

- **Resources are namespaced by module**: `invoices:read`,
  `users:write`. Match the module's short name so ownership is obvious.
- **Grant, don't define.** A feature module calling `defineRole()` usually
  means the role belongs in `core` instead. Introducing a role is
  deliberate and explicit — `allow()` on an unknown role is a boot error,
  never an implicit creation.
- The same role+resource granted by two modules crashes the boot. Since
  resources are namespaced, that always means a duplicated resource name.
- Wildcards: `*` (everything), `invoices:*` (whole namespace). Give `*`
  to `admin` only.
- Unknown roles always deny at runtime — the safe answer to "can this
  unheard-of role do X?" is no.

## Gotchas

- Load order matters: roles must exist before grants, which is why `core`
  is `tier: "sys", priority: 0`. If your module runs before the module
  defining a role, add it to `dependsOn`.
- `acl.can()` answers *what the role may do*, not *who the caller is*.
  Authentication (deciding the role) is your auth module's job.
- Roles are lowercase kebab-case; resources are `name:action`.
