# Working in this project

This is a **Tulipes** application (`@tulipes/core`) — a module-based Express
framework. It is convention-driven and deliberately fail-closed: almost
everything that can be validated at boot is, and a violation crashes the
process with a report rather than degrading quietly.

Writing plain Express here will fight the framework. Read the rule that
applies before you write code.

The `→ skill x` pointers below name a task-scoped guide in
`.claude/skills/<name>/SKILL.md`. Claude Code loads those on demand; any other
agent can read the file directly — they are plain markdown, and each one covers
one contract in depth.

## Preset scope

Read the installed modules and package scripts before applying integration examples.
The minimal preset has core, security and hello only. Auth, users, settings,
MongoDB, Redis, queues, sockets, shared logger/cache helpers and PM2 examples
below apply when those modules are installed (the production preset). Minimal
requests use the framework guest identity. Grant permissions to roles the app
actually defines. Use the generated Vitest suite for changes; production tests
require dedicated TEST_MONGO_URI and TEST_REDIS_URL services.

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
   picked up by the framework and read from `ctx.models`. Persisted and
   wire field names are `snake_case` (`created_at`, never `createdAt`);
   camelCase is for TypeScript-only names. → skill `tulipes-model`
4. **Global middleware belongs to a sys-tier module**, not to the
   entrypoint. `app.ts` stays three lines. → skill `tulipes-endpoint`
5. **Run `yarn sync` after touching any `meta.variables.json` or
   `module.config.ts`.** It regenerates `types/config.d.ts` and
   `.env.example`; stale generated types are a lie.
6. **Every response is `res.respond({ data, meta })`** — never `res.json`,
   which ships a raw body outside the envelope. Failures are **thrown**:
   `throw new HttpError(404, "notFound")`, where the message is an i18n
   key and the code derives from it. Never hand-roll an error shape.
   → skill `tulipes-response`
7. **Every route declares a RAI**: put `rai({ id: "x:read" })` first in
   each endpoint handler chain, including routes inside `defineRoutes()`.
   The id is also the ACL permission, and core refuses to boot if a route
   is missing one. Public is `acl.allow("guest", "x:read")`, never a
   missing check. → skill `tulipes-endpoint`
8. **Validate input with a zod schema on the RAI** (`body`, `query`,
   `params`, from `zod/v4`) rather than hand-rolled `if` checks. The same
   declaration generates the OpenAPI and Postman documents, so they cannot
   describe a shape the endpoint rejects. → skill `tulipes-spec`
9. **User-facing strings are keys, never literals.** `req.t("notFound")`
   inside a route reads that module's `i18n/<locale>.json` — the module is
   the namespace and `rai()` binds it. Never concatenate a translated
   string with a variable. → skill `tulipes-i18n`
10. **`req.auth` is who is calling** — `{ isAuthenticated, user, session }`,
    resolved before any feature route and never undefined inside one. Never
    re-parse the Authorization header or trust a claim from a token.
    → skill `tulipes-permissions`
11. **When auth is installed, secrets never go on the User model.** Passwords and keys belong in
    the auth module's `Credential` model, which is `select: false`.
12. **When auth is installed, a new feature module's namespace goes in BOTH the `admin` and
    `sysadmin` grants** in `modules/auth/module.acl.ts`. Neither role holds
    `*` — a wildcard would reach `settings:*` and make the sysadmin
    boundary a label rather than a rule. → skill `tulipes-settings`
13. **Cross-module imports use the package name** (`@app/users`,
    `@app/core`), never a relative path that climbs out of the module. The
    workspace boundary is what keeps modules independent, and a package
    name makes the dependency visible in package.json — declare it there
    and in `dependsOn`.

For endpoint changes, read `tulipes-endpoint`: native routers live in
`routes/*.routes.ts`. Use `defineRoutes()` and `runtime()` for offline inspection;
keep shared middleware and param callbacks beside their endpoints.

## Where things go

| Decision | Location |
|---|---|
| Value differs per deployment (URL, secret, toggle) | that module's `meta.variables.json` |
| Policy shared by ≥2 modules (pagination, body limit) | `config/app.config.ts` |
| Config for one feature | that module's `module.config.ts` |
| A string a user will read | that module's `i18n/<locale>.json`, reached with `req.t` |
| The shape of a request body/query | a zod schema on the route's `rai()` |
| Middleware for every request | a sys-tier module's routes file |
| Middleware for one feature's routes | that module's own `Router` |
| Helper used by ≥2 modules | the sys core module, exported from its `index.ts` and imported as `@app/core` |
| Helper used by one module | that module's `helpers/` |
| One-off task (backfill, export, admin chore) | `scripts/`, booted with `mode: "script"` |
| Anything you would `console.log` | `moduleLogger(ctx.Environment, "<module>", ctx.mode)` from `@app/core` |

## Boot order (why load order matters)

`sys` modules load before `app` modules; within a tier, lower `priority`
first; then `dependsOn` topological order. Config → translations → ACL →
database → queues → routes. If code needs something another module
provides, declare `dependsOn` — do not rely on luck.

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
