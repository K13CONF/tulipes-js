---
name: tulipes-module
description: Use when adding a new feature to a Tulipes app — a new module under modules/ — or when deciding whether something belongs in an existing module or a new one. Covers the tulipes manifest key, tier, priority, dependsOn and workspace wiring.
---

# Adding a module

A module is one feature, one folder, one workspace package. It owns its
routes, models, config, permissions and jobs, and can be deleted without
touching anything else.

## Decide first

- **Extend an existing module** when the work is part of that feature
  (another users endpoint → `modules/users`).
- **New module** when it is a separate feature with its own vocabulary.
- **The sys core module** when it is a shared helper with no routes or
  models of its own — export it from `modules/core/index.ts` and import it
  as `@app/core`. There is no top-level `lib/`: a helper two modules need
  is owned by a module like everything else.

## Steps

1. Scaffold: `yarn tulipes new module billing`. It creates every
   contract — package.json (scope detected from siblings), meta.variables,
   config with lifecycle hooks, ACL, helper, a controller class, routes
   declaring a RAI, model, bootstrap, queue and socket. Delete the ones this feature does not
   need; an absent file is always valid.
2. Set ordering in `modules/billing/package.json`:

```json
{
  "name": "@app/billing",
  "tulipes": { "tier": "app", "priority": 100, "dependsOn": ["users"] },
  "dependencies": { "@tulipes/core": "^0.3.0", "express": "^5" }
}
```

3. `yarn install` — the module is a workspace, so the package manager must
   link it before imports resolve.
4. Add only what the feature needs (every file is optional): `routes/`,
   `models/`, `queues/`, `sockets/`, `bootstrap/`, `module.acl.ts`,
   `i18n/` — the module is its own i18n namespace. → skill `tulipes-i18n`
5. `yarn sync && yarn dev` — the banner must list the module.

## The manifest key

| Field | Meaning |
|---|---|
| `tier` | `sys` loads before every `app` module. Use `sys` **only** for framework-level concerns: global middleware, roles, infra variables. A business feature is always `app`. |
| `priority` | Lower loads earlier within a tier. Default 100. Use it for coarse ordering, not for dependencies. |
| `dependsOn` | Short names (`"users"`, not `"@app/users"`) of modules that must load first. Declare this whenever you import from another module or read its config. |

## Gotchas

- **`dependsOn` and the npm dependency are two different things.** To
  import `@app/users` you need it in `dependencies` (resolution) *and* in
  `dependsOn` (load order). Missing the first fails at import; missing the
  second gives you a module whose config namespace may not exist yet.
- A `sys` module may not `dependsOn` an `app` module — that inverts the
  tier guarantee and crashes the boot.
- Cycles crash the boot with the cycle printed. If two modules need each
  other, the shared part belongs in the core module or a third module.
- The folder name is cosmetic; the **short name** (last segment of the
  package name) is what `dependsOn` and the config namespace use.
