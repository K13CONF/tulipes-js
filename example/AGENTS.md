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
The minimal preset has core, security, hello and agent only. Auth, users,
config, settings, MongoDB, Redis, queues, sockets, shared logger/cache helpers
and PM2 examples below apply when those modules are installed (the production
preset). Minimal
requests use the framework guest identity. Grant permissions to roles the app
actually defines. Use the generated Vitest suite for changes; production tests
require dedicated TEST_MONGO_URI and TEST_REDIS_URL services.

## Non-negotiable rules

1. **Never read `process.env` directly, and keep the environment small.**
   A value is an environment value only if boot needs it before the
   database answers (connection strings, the port, log destination) or it
   is a secret: declared under `tulipes.env` in the module's `package.json`
   as `"name": { "key": "VARIABLE", … }`, read as
   `ctx.config.<module>.<name>` — read-only, invisible to listings, beside
   the module's settings. Everything else is a *setting*: declared
   with a zod schema in that module's `module.config.ts`, stored in the
   settings store (the `settings` collection here; a JSON file under
   `config/` in an app without the Mongo store), edited through the
   console, read live at `ctx.config.<module>`. → skill `tulipes-env-variable`
2. **A feature is a module, not a layer.** Everything a feature needs —
   routes, models, config, permissions, jobs — lives in one folder under
   `modules/`. Never add a top-level `services/` or `middlewares/` folder.
   A module's root holds exactly `package.json`, `module.config.ts` and
   `module.acl.ts`; everything else has a folder (`routes/`, `controllers/`,
   `models/`, `schemas/`, `helpers/`, `bootstrap/`, `queues/`, `sockets/`,
   `i18n/`, `agent/`, `lib/`, `tests/`), and the boot refuses a stray root file.
   → skill `tulipes-module`
3. **Never call `mongoose.model()` yourself.** Models are declarations
   picked up by the framework and read from `ctx.models`. Persisted and
   wire field names are `snake_case` (`created_at`, never `createdAt`);
   camelCase is for TypeScript-only names. → skill `tulipes-model`
4. **Global middleware belongs to a sys-tier module**, not to the
   entrypoint. `app.ts` stays three lines. → skill `tulipes-endpoint`
5. **Run `pnpm sync` after touching a module's `tulipes.env`, a
   settings schema in `module.config.ts`, a model file or a queue file's
   `jobs` export.** It regenerates `types/tulipes.d.ts` and `.env.example`;
   stale generated types are a lie. With it, `ctx.config.core.port` is a
   `number`, `ctx.models.get("User")` is typed from the model's schema and
   `queues.add("users.welcome", …)` from the queue's job schema, so a wrong
   name or payload does not compile. `module.config.ts`
   has exactly one export, `defineConfig({ schema })`; initialization and
   cleanup belong to `bootstrap/*.bootstrap.ts`, which may return the
   function that closes what it opened, and long-lived work ends on
   `ctx.signal`.
6. **Every response is `res.respond({ data, meta })`** — never `res.json`,
   which ships a raw body outside the envelope. Failures are **thrown**:
   `throw new HttpError(404, "notFound")`, where the message is an i18n
   key and the code derives from it. Never hand-roll an error shape.
   → skill `tulipes-response`
7. **Every route declares a RAI**: put `rai({ id: "users:bo:list" })` first
   in each endpoint handler chain, including routes on a nested router.
   The id is always `module:scope:resource[:extra]` — `users:mobile:profile`,
   `users:bo:detail:delete` — where the scope is the surface it serves
   (`web`, `bo`, …). It is also the ACL permission, and core refuses to boot
   if a route is missing one or the id has another shape. Public is
   `acl.allow("guest", "users:web:list")`, never a missing check.
   → skills `tulipes-endpoint`, `tulipes-permissions`
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
    `*` — a wildcard would reach `config:bo:write` and `settings:*` and make
    the sysadmin boundary a label rather than a rule. → skills
    `tulipes-config`, `tulipes-settings`
13. **Cross-module imports use the package name** (`@app/users`,
    `@app/core`), never a relative path that climbs out of the module. The
    workspace boundary is what keeps modules independent, and a package
    name makes the dependency visible in package.json — declare it there
    and in `dependsOn`.
14. **Routes are the API; what a module offers to agents is declared
   apart.** `agent/<module>.agent.ts` lists the module's actions — id,
   description, input schema, handler — and nothing is derived from the
   routes. An action and a route share logic through `helpers/`; neither
   calls the other. `ctx.agent` carries every action in every process,
   and `pnpm mcp` serves them to MCP clients. Give an agent a credential
   limited to scopes (grant patterns, `hello:web:*`): a scope only ever
   narrows the user's role. → skills `tulipes-agent-tool`, `tulipes-permissions`
15. **A module's tests live in `modules/<name>/tests/` and boot the app
   through `@tulipes/testing`**: `useTestApp({ rootDir }, { beforeAll,
   afterAll })` once per file, `app.get(app.api("/x"))` with the envelope
   decoded, `app.as("admin")` for a signed-in role. Never boot per test, and
   never reach into another module's files from a test.

For endpoint changes, read `tulipes-endpoint`: native routers live in
`routes/`, named scope-first — `routes/web.users.routes.ts`,
`routes/bo.users.routes.ts`, and a folder per scope when one scope has
several files (`routes/web/hello.greetings.routes.ts`); controllers mirror
them (`controllers/bo.users.controllers.ts` exports `BoUsersController`).
They are plain `(ctx) => Router` functions: build the router from
the context, return it for the configured prefix, and read models and
config inside handlers, never while building — `tulipes routes` and
`tulipes spec` build every router with nothing acquired, and an environment
value read while building throws. Global middleware that needs one is built
on its first request with `lazy()` from `@app/core`.

## Where things go

| Decision | Location |
|---|---|
| Connection string, secret, or anything boot needs before the database answers | `tulipes.env` in that module's `package.json`, read at `ctx.config.<module>.<name>` |
| Policy shared by ≥2 modules and the same everywhere (pagination, locales); wiring the environment to what core and the providers read (`server.port`, `mongoose.*`, `bullmq.redisUrl`) | `config/app.config.ts` |
| A value an operator may change at runtime (limits, modes, toggles, lifetimes) | a field in that module's `module.config.ts` schema, read at `ctx.config.<module>` |
| Opening a client, seeding rows, ensuring indexes, and closing them again | that module's `bootstrap/*.bootstrap.ts`, returning the cleanup |
| A string a user will read | that module's `i18n/<locale>.json`, reached with `req.t` |
| The shape of a request body/query | a zod schema on the route's `rai()` |
| Middleware for every request | a sys-tier module's routes file |
| Middleware for one feature's routes | that module's own `Router` |
| Helper used by ≥2 modules | the sys core module, exported from its `lib/index.ts` and imported as `@app/core` |
| Helper used by one module | that module's `helpers/` |
| One-off task (backfill, export, admin chore) | `scripts/`, booted with `mode: "script"` |
| Anything you would `console.log` | `moduleLogger(ctx, "<module>")` from `@app/core` |

## Boot order (why load order matters)

`sys` modules load before `app` modules; within a tier, lower `priority`
first; then `dependsOn` topological order. Declarations → models →
settings → translations → ACL → bootstrap → queues → routes. If code needs
something another module provides, declare `dependsOn` — do not rely on
luck.

## Commands

| Command | Use |
|---|---|
| `pnpm dev` | run the backend process (regenerates types first) |
| `pnpm worker` | run the queue-consumer process |
| `pnpm mcp [--token t]` | serve the modules' actions to an MCP client on stdio; `config/mcp.config.ts` identifies the caller |
| `pnpm sync` | regenerate `types/tulipes.d.ts` + `.env.example` |
| `pnpm tulipes routes [--scope s]` | every endpoint with the roles that reach it, offline |
| `pnpm tulipes roles [--role r]` | every role with its description, extras and grants, offline |
| `pnpm tulipes agent manifest [--role r]` | print every tool the app exposes to agents, offline |
| `pnpm test` | every `tests/` and `modules/*/tests/` file; each boots the app once through `@tulipes/testing` |
| `pnpm check` | resolve every environment value and show where it lands, without booting |
| `pnpm typecheck` | typecheck the whole app |
| `pnpm tulipes new module <name> [--scope s]` | scaffold a module (its first endpoint in scope `s`, default `web`) |
| `tulipes update` | upgrade the global cli and the framework in every manifest |
| `pnpm script scripts/x.ts` | run a one-off script against the real app |

## Verifying your work

A change is not done until the app boots. Run `pnpm typecheck`, then
`pnpm dev` and confirm the startup banner lists what you added (modules,
queues, sockets, roles). Boot failures print an aggregate report naming
every problem at once — read all of it before fixing anything. → skill
`tulipes-boot-errors`
