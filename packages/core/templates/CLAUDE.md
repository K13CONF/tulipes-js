# Working in this project

This is a **Tulipes** application (`@tulipes/core`) — a module-based Express
framework. It is convention-driven and deliberately fail-closed: almost
everything that can be validated at boot is, and a violation crashes the
process with a report rather than degrading quietly.

Writing plain Express here will fight the framework. Read the rule that
applies before you write code.

## Non-negotiable rules

1. **Never read `process.env` directly.** Every configuration value is
   declared in a module's `meta.variables.json` and read with
   `ctx.Environment.get("NAME")`. Reading an undeclared name throws on
   purpose. → skill `tulipes-env-variable`
2. **A feature is a module, not a layer.** Everything a feature needs —
   routes, models, config, permissions, jobs — lives in one folder under
   `modules/`. Never add a top-level `services/` or `middlewares/` folder.
   → skill `tulipes-module`
3. **Never call `mongoose.model()` yourself.** Models are declarations
   picked up by the framework and read from `ctx.models`. → skill
   `tulipes-model`
4. **Global middleware belongs to a sys-tier module**, not to the
   entrypoint. `app.ts` stays three lines. → skill `tulipes-endpoint`
5. **Run `yarn sync` after touching any `meta.variables.json` or
   `module.config.ts`.** It regenerates `types/config.d.ts` and
   `.env.example`; stale generated types are a lie.
6. **Errors are `HttpError`.** `throw new HttpError(404, "…")` from
   anywhere in a route; the framework's terminal handler renders it.
   Never hand-roll an error-response shape.
7. **Every route declares a RAI**: `rai({ id: "x:read" })` from `ctx`.
   The id is also the ACL permission, and core refuses to boot if a route
   is missing one. Public is `acl.allow("guest", "x:read")`, never a
   missing check. → skill `tulipes-endpoint`
8. **Secrets never go on the User model.** Passwords and keys belong in
   the auth module's `Credential` model, which is `select: false`.
9. **Cross-module imports use the package name** (`@app/users`,
   `@app/core`), never a relative path that climbs out of the module. The
   workspace boundary is what keeps modules independent, and a package
   name makes the dependency visible in package.json — declare it there
   and in `dependsOn`.

## Where things go

| Decision | Location |
|---|---|
| Value differs per deployment (URL, secret, toggle) | that module's `meta.variables.json` |
| Policy shared by ≥2 modules (pagination, body limit) | `config/app.config.ts` |
| Config for one feature | that module's `module.config.ts` |
| Middleware for every request | a sys-tier module's routes file |
| Middleware for one feature's routes | that module's own `Router` |
| Helper used by ≥2 modules | the sys core module, exported from its `index.ts` and imported as `@app/core` |
| Helper used by one module | that module's `helpers/` |
| One-off task (backfill, export, admin chore) | `scripts/`, booted with `mode: "script"` |
| Anything you would `console.log` | `moduleLogger(ctx.Environment, "<module>", ctx.mode)` from `@app/core` |

## Boot order (why load order matters)

`sys` modules load before `app` modules; within a tier, lower `priority`
first; then `dependsOn` topological order. Config → ACL → database →
queues → routes. If code needs something another module provides, declare
`dependsOn` — do not rely on luck.

## Commands

| Command | Use |
|---|---|
| `yarn dev` | run the backend process (regenerates types first) |
| `yarn worker` | run the queue-consumer process |
| `yarn sync` | regenerate `types/config.d.ts` + `.env.example` |
| `yarn check` | validate the environment without booting |
| `yarn typecheck` | typecheck the whole app |
| `yarn tulipes new module <name>` | scaffold a module |
| `tulipes update` | upgrade the global cli and the framework in every manifest |
| `yarn script scripts/x.ts` | run a one-off script against the real app |

## Verifying your work

A change is not done until the app boots. Run `yarn typecheck`, then
`yarn dev` and confirm the startup banner lists what you added (modules,
queues, sockets, roles). Boot failures print an aggregate report naming
every problem at once — read all of it before fixing anything. → skill
`tulipes-boot-errors`
