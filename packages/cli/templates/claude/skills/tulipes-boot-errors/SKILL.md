---
name: tulipes-boot-errors
description: Use when a Tulipes app fails to boot, when a route/model/queue you added is not being picked up, or when reading a TulipesBootError report. Maps each boot phase's crash message to its cause and fix.
---

# Diagnosing a boot failure

Boot crashes with a `TulipesBootError` naming the phase and listing
**every** problem found in that phase:

```
TulipesBootError: Boot aborted during "environment" — 3 issue(s):
  ✖ [core] required variable "MONGO_URI" has no value (…)
  ✖ [users] variable "USERS_MAX_SESSIONS": "abc" is not a number
  ✖ [users] required variable "USERS_ADMIN_EMAIL" has no value (…)
```

**Read the whole list before changing anything.** The report is complete
for that phase — fixing one line at a time wastes restarts. Phases run in
order and stop at the first failing one, so a later phase may still hold
problems the report has not reached yet.

## By phase

| Phase | Typical message | Cause and fix |
|---|---|---|
| `environment` | `required variable "X" has no value` | Declared `required` but nothing supplies it. Add it to `.envs/.env.<APP_ENV>`, or give the spec a `default`. |
| `environment` | `"abc" is not a number` / `not one of: …` | Value fails its declared `type`/`enum`. Fix the value or the spec. |
| `environment` | `variable "X" is already declared by module "y"` | Two modules declare the same `key`. Delete the duplicate; read the other module's config instead. |
| `environment` | `config.x.name is both a setting and an environment value` | A `tulipes.env` name is also a field of that module's settings schema. Rename one; they share the namespace. |
| `environment` | `tulipes.env is an object keyed by config name since 0.12` | The 0.11 array form. Run `tulipes migrate 0.12`, which rewrites it and the reads. |
| `module graph` | `dependsOn "x" — no such module exists` | Typo, or you used the package name. `dependsOn` takes short names (`"users"`). |
| `module graph` | `dependency cycle: a → b → a` | Mutual dependency. Move the shared part into the core module or a third module. |
| `module graph` | `sys module cannot depend on app module` | A sys module needs something app-tier. Either it is not really sys, or the dependency belongs in `lib/`. |
| `modules` | `x does not belong at the module root` | Only `package.json`, `module.config.ts` and `module.acl.ts` live there; the message names the folder the file belongs in. |
| `modules` | `tulipes.offline is gone` / `meta.variables.json … moved to package.json` | The 0.10 forms. Delete the flag; run `tulipes migrate 0.11` then `0.12` for the variables. |
| `routes` | `routes function threw: ctx.models is not available during inspection` / `config.x.name is an environment value, not available during inspection` | A routes file or a controller constructor touched infrastructure or an environment value while building. Move the read into the handler, or build the middleware with `lazy()`. |
| `config` | `app.config returns "x", which is the config namespace of module "x"` | `config/app.config.ts` seeded a key named after a module; that namespace holds the module's settings and environment values. Rename the key. |
| `config` | `module.config must default-export defineConfig({ schema })` | Missing/misspelled `export default`, or the 0.10 factory form: values now live in the settings store. |
| `config` | `module.config exports "onReady"` | The 0.10 lifecycle exports. Initialization is a `bootstrap/*.bootstrap.ts` file, which may return its cleanup; long-lived work ends on `ctx.signal`. |
| `config` | `field "x" has no default — every setting needs one` | Give the field a `.default()`; an operator is never asked for a value the process needs to boot. |
| `settings` | `stored setting "users.maxSessions": …` | The store holds a value the schema no longer accepts. Fix it in the store (or the file the message names). |
| `acl` | `allow() on unknown role "x"` | Role never defined. Roles live in the sys `auth` module; define it there and `dependsOn: ["auth"]`. |
| `acl` | `already granted … duplicate grant` | Two modules grant the same role+resource. Namespace the resource by module. |
| `providers` | `[x] requires capability "models" … declares no provider for it` | A module has `models/` files (or `requires: ["models"]`) but the app's `package.json` has no `"tulipes": { "providers": { "models": "@tulipes/mongoose" } }`. Add that line; an installed package or a `MONGO_URI` alone selects nothing. |
| `providers` | `provider "…" cannot be resolved from …` | The declared specifier is not installed in the app. Install it (or fix the path). |
| `providers` | `"@tulipes/core/db" no longer contains the Mongoose provider` | The app still declares the pre-extraction specifier. Install `@tulipes/mongoose`, declare it, and import `ModelDef`/`BootstrapFn` from it. |
| `providers` | `[x] requires capability "queues" … declares no provider for it` | A module has a `queues/` file (or `requires: ["queues"]`) but the app's `package.json` has no `"tulipes": { "providers": { "queues": "@tulipes/bullmq" } }`. Add that line. |
| `providers` | `provider "bullmq" is selected but config.bullmq.redisUrl is not set` | Wire it in `config/app.config.ts` — `bullmq: { redisUrl: env.core.redisUrl }` — from a variable the sys `core` module declares, and set that variable. |
| `providers` | `"@tulipes/core/queues" no longer contains the BullMQ provider` | Install `@tulipes/bullmq`, declare it, and import `QueueRegistry`/`QueuesFn` from it. |
| `providers` | `[x] requires capability "sockets" … declares no provider for it` | A module has a `sockets/` file (or `requires: ["sockets"]`) but the app's `package.json` has no `"tulipes": { "providers": { "sockets": "@tulipes/socket.io" } }`. Add that line. |
| `providers` | `"@tulipes/core/sockets" no longer contains the Socket.IO provider` | Install `@tulipes/socket.io`, declare it, and import `SocketRegistry`/`SocketsFn` from it. |
| `providers` | `provider "socket.io" failed to attach to the HTTP server` | The transport could not bind to the server core created; the message carries the driver's reason. |
| `providers` | `provider "mongoose" is selected but config.mongoose.uri is not set` | Wire it in `config/app.config.ts` — `mongoose: { uri: env.core.mongodbUri }` (or the host, user, pass and dbName parts) — from variables the sys `core` module declares, and set them. |
| `providers` | `database connection failed (config.mongoose.uri)` | Mongo unreachable or the URI wrong. Check the service is running and what `pnpm check` resolved. |
| `providers` | `package.json "tulipes" key: providers — Unrecognized key` | Typo in the capability name; only `models` exists. |
| `providers` | `queue name … is invalid` | Queue names use `.`, not `:`. |
| `routes` | `must default-export a routes function` | Missing `export default` in a `*.routes.ts`. |

## "My file is being ignored"

The framework discovers files by convention. If something you added never
runs, check in this order:

1. **Filename suffix** — `*.routes.ts`, `*.model.ts`, `*.queues.ts`,
   `*.sockets.ts`, `*.bootstrap.ts`, `module.config.ts`, `module.acl.ts`.
   A file named `users.route.ts` (no `s`) is invisible.
2. **Directory** — routes in `routes/`, models in `models/`, and so on.
   Nested subfolders are not scanned.
3. **The module is registered** — it needs a `package.json` and a
   `pnpm install` after creation. The startup banner lists every module it
   found; if yours is missing, the problem is there.
4. **`export default`** — every contract file except models exports a
   function as its default.

## Other symptoms

- **Types are `unknown` or a new environment value is not typed** → run `pnpm sync`.
- **`console.log(ctx.config.core)` does not show an environment value** →
  by design; they are non-enumerable so a secret never reaches a log or a
  response. `pnpm check` shows them.
- **Worker exits immediately** → no processors registered; it refuses to
  idle. Add a `*.queues.ts` with `process()`.
- **Env change has no effect** → `process.env` beats the file. Check for a
  shell export or container variable of the same name.
- To validate configuration without booting the whole app: `pnpm check`.
