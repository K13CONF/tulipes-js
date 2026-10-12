<div align="center">

<img src="https://cdn.jsdelivr.net/npm/@tulipes/core@0.7.1/assets/tulipesjs-logo.png" alt="TulipesJs" width="440">

**The Express framework that refuses to start when something is wrong.**

[![npm](https://img.shields.io/npm/v/@tulipes/core?color=%23cb3837&label=%40tulipes%2Fcore)](https://www.npmjs.com/package/@tulipes/core)
![node](https://img.shields.io/badge/node-%E2%89%A5%2020.11-5FA04E)
![types](https://img.shields.io/badge/types-included-3178C6)
![express](https://img.shields.io/badge/express-5-000000)

</div>

---

You write **modules** — one folder per feature, holding its own routes, models,
config, permissions and background jobs. Tulipes discovers them, orders them,
validates them, and wires them into a running API.

Everything checkable is checked at boot, and every failure is reported **in
aggregate**. Ten missing environment variables is one crash listing ten
problems, not ten restarts.

```
TulipesBootError: Boot aborted during "environment" — 3 issue(s):
  ✖ [core]  required variable "MONGO_URI" has no value
  ✖ [users] variable "USERS_MAX_SESSIONS": "abc" is not a number
  ✖ [users] required variable "USERS_ADMIN_EMAIL" has no value
```

## Quick start

Requires Node 24.x and pnpm. The 0.10 line is stable — its API is settled
and breaking changes wait for 0.11 — but no production pilot has run it yet;
the [compatibility policy](../../docs/support.md) says exactly what that leaves
unproven.

```sh
npm install -g @tulipes/cli
tulipes init my-api
cd my-api
pnpm install
pnpm sync
pnpm typecheck
pnpm check
pnpm test
pnpm spec
pnpm dev
```

Open http://localhost:3000/api/v1/hello or http://localhost:3000/health.
The default minimal preset contains core, security middleware and a hello
module with tests. It requires no MongoDB, Redis or credentials. `--minimal`
and `--preset minimal` select the same starter.

For authentication, users, settings, database, queues, sockets and deployment
examples, use `tulipes init my-api --preset production`. That preset requires
MongoDB and Redis; add `--no-queues` or `--no-sockets` to leave either provider
out, and the generated app carries neither its dependencies nor its files. Its
generated README explains environment setup and tests.

Core itself installs no driver. An app declares the infrastructure it wants:

```jsonc
// package.json — the whole of the selection
{ "tulipes": { "providers": {
  "models":  "@tulipes/mongoose",
  "queues":  "@tulipes/bullmq",
  "sockets": "@tulipes/socket.io"
} } }
```

A module that owns `models/`, `queues/` or `sockets/` files requires its
provider automatically, and a module that only consumes one says so with
`"tulipes": { "requires": ["models"] }`. Declaring nothing is the normal case
for the minimal preset, and it is what the runtime cost measures: installing
`@tulipes/core` alone brings 75 packages and 7.6 MB, against 151 packages and
53 MB in 0.9, when every driver and the CLI came with the framework. A
development install is larger in both — TypeScript, Vitest and the CLI are the
app's own devDependencies.

## Why

**Modules, not layers.** A feature lives in one folder. Delete the folder and
the feature is gone — no dangling registration left in six other files.

**Fail closed, everywhere.** Missing variables, dependency cycles, duplicate
ACL grants, colliding queue names: all crash the boot with a full report.
Reading an undeclared variable or an unregistered model throws at the call
site. Unknown roles deny. Unrouted requests 404. Unexpected errors never leak
internals outside development.

**One codebase, three processes.** The same app boots as a `backend` server, a
queue-consuming `worker`, or a one-shot `script` — same modules, same config,
forked at the last pipeline phase. A maintenance script therefore runs against
exactly the configuration the server has, never an approximation of it.

**Types generated, not hand-written.** `tulipes sync` reads your modules and
emits a `types/tulipes.d.ts`: enum variables become literal unions, config
namespaces are the output of each module's settings schema, `ctx.models.get()`
is typed from each model file's schema and `queues.add()` from each queue
file's job schemas — a wrong name or payload does not compile.

**The framework stays out of your request path.** Core mounts *no* middleware.
Your sys-tier modules own the head of the pipeline; core guarantees only the
fail-closed tail — a 404 for anything unrouted, and a terminal error handler.

## A module

Every module is a workspace package under `modules/`. Every file is optional
except `package.json` — `tulipes new module <name>` generates them all, so you
delete what this feature does not need.

```
modules/billing/
├── package.json              name, "tulipes" ordering key and env contract
├── module.config.ts          defineConfig({ schema }): this module's settings
├── module.acl.ts             permission grants
├── routes/                   (ctx) => Router, mounted under config.api.prefix
│   ├── web.billing.routes.ts       named scope-first, by convention; any depth is read
│   └── bo.billing.routes.ts
├── controllers/              the work; bo.billing.controllers.ts → BoBillingController
├── schemas/*.schemas.ts      zod request schemas shared by routes
├── helpers/                  pure logic, no framework
├── lib/index.ts              the module's public exports (package.json "exports")
├── i18n/<locale>.json        this module's strings — the module is the namespace
├── models/*.model.ts         { name, schema } — a declaration, not a registration
├── bootstrap/*.bootstrap.ts  initialization, every mode; may return its cleanup
├── queues/*.queues.ts        (ctx, queues) => process; `jobs` export declares the schemas
├── sockets/*.sockets.ts      (ctx, sockets) => claim a namespace
└── agent/*.agent.ts          defineAgent({ summary, actions }): what the module offers to agents
```

```json
{
  "name": "@app/billing",
  "tulipes": { "tier": "app", "priority": 100, "dependsOn": ["users"] },
  "dependencies": { "@app/users": "workspace:*" }
}
```

**Load order** is three keys: tier (`sys` before `app`) → `priority` → a
topological sort on `dependsOn`. Cycles, unknown dependencies, and a sys module
depending on an app module all crash the boot. Cross-module imports go through
package names, so the package manager enforces that a module only uses what it
declares.

## The environment contract

Each module declares the variables it needs. Plain JSON, so tooling can read a
module's contract without executing its code.

```json
{
  "variables": [
    {
      "name": "STRIPE_API_KEY",
      "type": "secret",
      "group": "billing",
      "required": true,
      "description": "Server-side Stripe key"
    },
    {
      "name": "BILLING_TRIAL_DAYS",
      "type": "number",
      "group": "billing",
      "description": "Free trial length",
      "default": 14
    }
  ]
}
```

```ts
ctx.Environment.get("BILLING_TRIAL_DAYS"); // number, after `tulipes sync`
ctx.Environment.get("TYPO_NAME");          // throws — never declared
```

Resolution is **`process.env` › `.envs/.env.<APP_ENV>` › `default`**, so
container-injected values always win. Values are coerced and validated against
their declared type, and `secret` values are redacted in logs, reports and the
startup banner.

| Field | Rules |
|---|---|
| `name` | UPPER_SNAKE, **one owner per variable** — two modules declaring the same name is a boot crash naming both |
| `type` | `string` · `number` · `boolean` · `enum` · `url` · `secret` |
| `enum` | required with `type: "enum"`; generates a literal union |
| `required` | no value anywhere → boot crash; mutually exclusive with `default` |
| `default` | used when nothing supplies a value |
| `group` | free-form label; groups the variable in the generated `.env.example` |

The mode comes from `APP_ENV`, deliberately **not** `NODE_ENV` — bundlers and
libraries overload that one as an optimisation flag.

## Translations

A module is an i18n namespace. `modules/users/i18n/en.json` holds everything
the users module can say, and `req.t` inside a users endpoint is already bound
to it — because `rai()` recorded which module declared that route.

```ts
// modules/users/controllers/users.controllers.ts
res.json({ message: req.t("created", { email }) });   // modules/users/i18n/<locale>.json
throw new HttpError(404, req.t("notFound"));
```

```jsonc
// modules/users/i18n/en.json
{
  "created": "User {{email}} created",
  "notFound": "No such user",
  "list": { "count_one": "{{count}} user", "count_other": "{{count}} users" }
}
```

The locale is negotiated per request: `?lang=fr` first, then
`Accept-Language` with its q-values, then `config.i18n.defaultLocale` —
each candidate narrowed to `supportedLocales`, so an unsupported language
falls through rather than serving raw keys. `fr-CA` is served by `fr`
unless the app ships `fr-CA` itself.

Code with no request names both explicitly, which is how a queue processor
translates against the recipient's own locale rather than the enqueuer's:

```ts
const t = ctx.t("users", recipient.locale);
await sendMail(t("welcome.subject", { name }));
```

Only the default locale has to be complete. A key another locale lacks
falls back to it, and every gap is written to `modules/<name>/i18n/<locale>.missing.json`
with the default text as the value — a work list for a translator, rewritten
on each non-production boot and never written in production. Invalid JSON, or
an `i18n/` folder with no default-locale file, aborts the boot: i18next would
otherwise serve raw keys with nothing in the log to explain it.

## One response shape

Every endpoint answers with the same envelope, so a client writes its
unwrapping once and branches on a code rather than parsing prose:

```jsonc
{ "success": true, "data": { }, "errors": [], "meta": {} }
{ "success": false, "data": null,
  "errors": [{ "field": "email", "message": "Cette adresse est prise",
               "code": "EMAIL_TAKEN" }],
  "meta": {} }
```

`res.respond` builds it. Express is untouched — `res.json`, `res.send` and
`res.status` behave exactly as they always did:

```ts
res.respond({ data: user });
res.respond({ data: user, status: 201 });
res.respond({ data: null, meta: { action: "complete_profile" } });
```

Failures are **thrown**, never responded, and the terminal handler builds
the same envelope from them — so a handler only ever writes the happy
path. The message is an i18n key: it is translated in the module's
namespace (the one the route's RAI recorded) and the error code is derived
from it, so `notFound` becomes `NOT_FOUND` with no second string to keep
in step.

```ts
throw new HttpError(404, "notFound");
throw new HttpError(422, "emailTaken", { field: "email" });
throw new ValidationError([               // several fields, one response
  { field: "email", message: "emailRequired" },
  { field: "password", message: "passwordTooShort" },
]);
```

Pagination is opt-in per response. `req.page` is parsed from `?page` and
`?per_page` and clamped by `config.pagination`, and passing `total_items`
is what marks a response as a page — so a single record's `meta` stays
`{}` rather than carrying four nulls:

```ts
const { per_page, skip } = req.page;
res.respond({ data: items, meta: { total_items } });
// meta: { page: 2, per_page: 10, total_pages: 5, total_items: 50 }
```

In development, a route that answers without `res.respond` logs a warning
naming it. Nothing is intercepted and the raw body still ships — the point
is that the slip is visible the first time the route is hit.

## Who is calling

Core reads one field, `req.auth`, and an auth module's only job is to put
one there — swap JWT for sessions or mTLS and nothing else changes:

```ts
interface Auth {
  isAuthenticated: boolean;
  user: AuthUser | null;      // augmented by the app's auth module
  session: AuthSession | null;
}
```

`rai()` guarantees it: inside a declared route `req.auth` is never
undefined, falling back to the guest value, and the ACL check reads the
role through `req.auth.user`. An app whose roles do not live on the user —
a claims service, a join table — replaces the decision itself with
`ctx.routes.setAccessChecker()` rather than faking a user.

Custom checkers return a boolean or `Promise<boolean>`. Core waits for the result
before validation and endpoint handlers; only `true` grants access. A rejected
policy reaches the normal error handler. Each request receives its own guest
auth state, so changing one request cannot identify another caller.

`AuthUser` and `AuthSession` are empty interfaces in core, filled in by the
app through declaration merging, so `req.auth.user.email` is typed at every
call site without core knowing anything about your models.

## RAI ids, grants and roles

A RAI id names one endpoint or agent action, and is the permission the ACL
decides on:

```
{module}:{scope}:{resource}[:{extra}]

users:bo:list              users:mobile:profile              users:bo:detail:delete
```

The module is the declaring module's name; the scope is the surface the
permission serves (`bo`, `web`, `mobile`, whatever the app names); the
resource is what is reached; the optional extra is a variant of it. Every
segment is `[a-z][a-z0-9-]*`. `RouteInfo.id` is typed so a two-segment id
fails in the editor, and the route scan refuses any other shape at boot.
`parseRai(id)` from `@tulipes/core/http` returns `{ module, scope, resource, extra? }`.

A grant is an id, `*`, or a prefix ending in `:*`, which covers everything
under it, the bare resource included: `users:bo:detail:*` reaches
`users:bo:detail` and `users:bo:detail:delete`; `users:bo:*` the users back
office; `users:*` every users surface.

A role is defined once and may carry a description and any extra the app
reads back. Augment `RoleMeta` to type the extras:

```ts
declare module "@tulipes/core/acl" {
  interface RoleMeta { level?: number }
}

acl.defineRole("admin", { description: "Runs the back office", level: 2 });

ctx.acl.role("admin");          // { name, definedBy, description, level }, frozen
ctx.acl.describeRoles();        // every role, in definition order
ctx.acl.rolesFor("users:bo:list");   // who holds it, resolved like a request
```

`tulipes roles` prints every role with its grants; `tulipes routes --scope bo`
and `tulipes spec --scope mobile` show or describe one surface.

## The boot pipeline

```
 1  Environment      .env.<APP_ENV> + every package.json tulipes.env → validate
 2  Module graph     "tulipes" keys → tier / priority / topological sort
 3  Exploration      resolve conventional paths in load order, import nothing
 4  Declarations     config/app.config.ts seed; each module.config.ts schema
 5  Models, settings providers connect (@tulipes/mongoose: connection → model store;
    @tulipes/mongoose/settings: the `settings` collection behind ctx.settings)
 6  Settings         every namespace read from the store, seeded on first boot,
                     validated against its schema → ctx.config.<module>
 7  Translations     modules/*/i18n/*.json, one namespace per module
 8  ACL              module.acl.ts in load order
 9  Bootstrap        bootstrap/*.bootstrap.ts in load order, every mode;
                     a returned function is the module's cleanup
10  Queues, sockets  queues (@tulipes/bullmq: every *.queues.ts registers),
                     sockets (@tulipes/socket.io, backend only: namespaces claimed)
11  ── fork ──
    backend          module routers → 404 → error handler → providers attach → listen
    worker           each provider serves: one BullMQ worker per processor
    script           start nothing; the caller owns the process
12  Banner
    shutdown         SIGTERM → ctx.signal aborts + stop/drain http + provider drain →
                     bootstrap cleanups in REVERSE order → providers disposed in reverse
```

Each phase crashes with its own aggregate report before the next begins.
`ctx.signal` aborts the moment shutdown begins, before HTTP stops accepting,
so an SSE handler or a poller ends while everything it needs is still alive;
cleanups run after traffic drains, under one deadline, and a failed or stuck
cleanup is aggregated without preventing the ones after it.

<details>
<summary><b>Contracts — what each file exports</b></summary>

```ts
interface Ctx {
  mode: ProcessMode;        // "backend" | "worker" | "script"
  rai: (info: RouteInfo) => RequestHandler;  // declare + gate an endpoint
  routes: RouteRegistry;    // every declared endpoint
  Environment: Environment; // typed variable store
  config: GlobalConfig;     // namespaced by module: config.billing
  t: (ns: string, locale?: string) => TFunction;  // off-request translator
  i18n: I18nextInstance;    // the instance underneath
  acl?: Acl;                // after phase 6
  models?: ModelsCapability; // after phase 8, when package.json declares a models provider
  queues?: QueuesCapability; // after phase 7, when package.json declares a queues provider
  sockets?: SocketsCapability; // backend only, when package.json declares a sockets provider
  app?: Express;            // backend only
}

// module.config.ts — this module's settings, stored at config.<module>, kept
// live: an operator's write through ctx.settings lands without a restart.
// They persist in config/settings.<APP_ENV>.json until the app declares
// "providers": { "settings": "@tulipes/mongoose/settings" } — then in the
// `settings` collection, versioned, with history, propagated to every replica.
export default defineConfig({
  schema: z.object({
    trialDays: z.number().int().positive().default(14).describe("Free trial length"),
  }),
  onChange(next, ctx) {},                          // optional: rebuild what depends on it
});

// routes/web.billing.routes.ts — every route declares a RAI, or the boot fails.
// An id is module:scope:resource[:extra], and it is the permission.
export default function billingRoutes(ctx: Ctx): Router {
  const router = Router();
  const billing = new WebBillingController(ctx);   // controllers are classes

  router.get(
    `${ctx.config.api!.prefix}/invoices`,
    ctx.rai({ id: "billing:web:invoices", name: "List invoices" }),
    billing.list(),
  );
  return router;
}

// models/*.model.ts — a declaration; never call mongoose.model() yourself.
// Needs the app to declare its models provider in package.json:
//   "tulipes": { "providers": { "models": "@tulipes/mongoose" } }
export default { name: "Invoice", schema } satisfies ModelDef; // ModelDef from @tulipes/mongoose

// bootstrap/*.bootstrap.ts — the one place a module initializes: every mode,
// after settings and ACL, before routes. Idempotent; may return its cleanup.
export default async function seed(ctx: RuntimeCtx) {
  const client = openSomething(ctx);
  ctx.signal.addEventListener("abort", () => client.stopPolling());   // shutdown began
  return () => client.close();                                         // after traffic drains
}

// queues/*.queues.ts — ONE file, both sides; the process mode decides.
// Needs "tulipes": { "providers": { "queues": "@tulipes/bullmq" } }; QueueRegistry from @tulipes/bullmq
export default function billingQueues(ctx: Ctx, queues: QueueRegistry) {
  queues.define("billing.send-invoice");                     // producers, always
  queues.process("billing.send-invoice", async (job) => {}); // consumed in worker
}

// sockets/*.sockets.ts — a namespace is claimed by exactly one module.
// Needs "tulipes": { "providers": { "sockets": "@tulipes/socket.io" } }; SocketRegistry from @tulipes/socket.io
export default function billingSockets(ctx: Ctx, sockets: SocketRegistry) {
  sockets.namespace("/billing", (nsp) => nsp.on("connection", () => {}));
}

// module.acl.ts — roles are global, grants are local and namespaced
export default function billingAcl(acl: AclBuilder) {
  acl.allow("user", "billing:web:invoices");
  acl.allow("admin", "billing:bo:*");             // the whole billing back office
}
```

Errors are one class. Express 5 forwards rejected async handlers to the
framework's terminal handler, so `throw` is the whole story:

```ts
import { HttpError } from "@tulipes/core/http";

if (!invoice) throw new HttpError(404, "no such invoice", { id });
```

`HttpError` renders `{ error, details? }` with its status. Middleware errors
carrying a 4xx are honoured too — an oversized body stays a `413`, malformed
JSON a `400`. Everything else becomes an anonymous `500`, with the real message
only in development.

</details>

## The CLI

The command line is its own package, [`@tulipes/cli`](https://www.npmjs.com/package/@tulipes/cli):
install it globally to scaffold, and generated apps also list it in
`devDependencies` so `pnpm dev`, `pnpm sync` and `pnpm tulipes …` need no
global install. Core itself ships no binary, no templates and no TypeScript
loader — a running app installs only the HTTP runtime.

| Command | What it does |
|---|---|
| `tulipes init [dir] [--minimal \| --preset minimal \| --preset production] [--no-queues] [--no-sockets]` | scaffold an application; no services; the opt-outs compose the production preset without that provider |
| `tulipes dev [entry]` | regenerate types, then run the entrypoint with `node --watch` |
| `tulipes sync` | regenerate `types/tulipes.d.ts` and `.env.example` |
| `tulipes env:check` | validate the environment without booting — a CI gate |
| `tulipes routes [--scope s]` | list every declared endpoint with the roles that reach it; no service, secret or `.env` |
| `tulipes roles [--role r]` | list every role with its description, extras, defining module and grants |
| `tulipes spec [--openapi file] [--postman file] [--url base] [--scope s]` | generate documents from the same inspection, for one scope if asked |
| `tulipes config:check` | load every settings namespace from the store and print it |
| `tulipes migrate 0.11` | rewrite an app generated on 0.10 to the 0.11 layout and contracts |
| `tulipes migrate 0.12 [--scope s]` | give every RAI id, grant and reference a scope (`users:read` → `users:web:read`) |
| `tulipes config:import` | carry env values that became settings into the store |
| `tulipes new module <name>` | scaffold a module with every contract |
| `tulipes update` | upgrade the global CLI and, inside an app, the app itself |
| `tulipes -v` | print the CLI version, and the app's when they differ |

`update` handles two separate installs: the global `@tulipes/cli` on your PATH,
and the `@tulipes/core` an app depends on — including every module, since
modules declare it themselves — plus the app's own `@tulipes/cli`. It reinstalls the CLI into the prefix it already lives
in, which is what makes it work under nvm, where a plain `npm install -g` may
target a different Node version than the one holding your binary.

`init`, `sync`, `env:check`, `new module`, version and update commands do not
connect application infrastructure (`update` uses the package registry). `dev`
and `config:check` boot the application and require its declared services.
`routes`, `spec` and `agent manifest` run an **inspection boot**.

### Inspection

`tulipes routes` and `tulipes spec` boot the application in **inspection**:
the normal boot with nothing acquired. Every `routes/*.routes.ts` runs
through the same loader and the same scan as a serving process, so what the
tools describe is exactly what is mounted; what differs is the context the
routes files receive:

| | serving | inspection |
|---|---|---|
| `ctx.Environment` | resolved and validated | declared and validated, every read throws |
| `ctx.models`, `ctx.queues`, `ctx.sockets` | the declared providers | stubs that throw on use (undefined when not declared) |
| `ctx.config.<module>` | the settings store | each schema's defaults, in memory |
| bootstrap | runs | skipped |
| listener, transports | yes | no |

The consequence is a rule a routes file already follows when it is written
well: build the router from the context and use infrastructure inside
handlers. A controller keeps `ctx` and reads `ctx.models` when a request
arrives; a middleware that needs a variable or a client is built on its
first request (`lazy()` in the reference app's core module). A file that
reads a variable or a model while building fails inspection with its path
and the reason, which is the right outcome: it would have coupled routing
to a service.

```sh
tulipes routes
tulipes spec --openapi docs/openapi.json --postman docs/collection.json
tulipes spec --openapi docs/openapi.json --url https://api.example.com
```

Programmatically, `boot({ rootDir, mode: "backend", inspect: true })` returns
the same handle a serving boot does, with `ctx.routes.all()`, `ctx.acl` and
`ctx.config` filled; the reference app's tests compare the inspection's
documents with the running app's. Provider declarations (`tulipes.providers`
in the root manifest, `requires` in module manifests) are validated for
consistency, but no provider is resolved or imported, so an uninstalled
provider is not an inspection error. A custom access checker installed while
building is reported as dynamic: generated documents make no static role or
public-access claim for it.

Before 0.11 inspection was an opt-in path (`tulipes.offline`,
`defineRoutes()`, `runtime()`, `--offline`); those forms are refused by name
and the migration guide says what replaces each.

## What `tulipes init --preset production` gives you

The framework is the engine; the scaffold is a complete application you own and
edit:

- **`modules/core`** (sys, priority 0) — infrastructure variables, the global
  role vocabulary, request ids, and shared helpers exported as `@app/core`: a
  cache (`Cache` contract, Redis and LRU-capped memory drivers), Mongoose base
  plugins (snake_case timestamps, soft delete), and a **logger** writing a
  coloured human-readable console *and* rotating JSON-line files, plus an
  errors-only copy. Log files carry the process mode, because backend and
  worker run at once and two processes rotating one file will race.
- **`modules/security`** (sys, priority 10) — helmet tuned for an API, CORS
  that is fail-closed by default, pino-http request logging, and a body-size
  cap. Core mounts no middleware; this module *is* the head of the pipeline.
- **`modules/auth`** (sys) — JWT with refresh rotation and blacklisting,
  passport, a `Credential` model so no secret ever touches the user
  document, and `Session` rows that survive rotation, so an account can
  list and end its own devices. It resolves `req.auth` for every request.
- **`modules/hello`** — a worked example of every contract.
- **`scripts/`** — one-off tasks that boot in `script` mode, plus an nginx
  deploy script that renders a per-environment template, links `sites-enabled`,
  runs `nginx -t` and reloads.
- **`ecosystem.config.cjs`** — PM2 definitions for both processes across
  development, staging and production, with `kill_timeout` long enough for
  graceful shutdown to drain queues and close connections.

## Built for AI-assisted work

`tulipes init` also writes an **`AGENTS.md`** — the cross-tool convention every
coding agent reads — plus a short `CLAUDE.md` pointing at it and task-scoped
skills under `.claude/skills/`: module, environment variable, endpoint,
response, model, queue, socket, permissions, config (settings and the
console), settings (the log stream), i18n, spec, agent tools and reading boot
errors. They encode the conventions an agent would otherwise
guess wrong: declaring variables instead of reaching for `process.env`, why
`mongoose.model()` is never called directly, where global middleware belongs,
and how to read an aggregate boot report. The skills are plain markdown, so an
agent without skill support can read them directly.

**What a module offers to agents is declared apart from its API.** Routes
are the API; `agent/*.agent.ts` lists the module's actions — an id that is
also the permission, a description written for a model, a zod input schema
and a handler — and nothing is derived from the routes. An action and a
route share logic through the module's helpers:

```ts
export default defineAgent({
  summary: "Greets callers and counts how often each greeting is used.",
  actions: [
    action({ id: "hello:list-greetings", description: "The stored greetings, most used first", readOnly: true,
             handler: async (ctx) => (await findGreetings(ctx))[0] }),
    action({ id: "hello:reset-counts", description: "Reset every counter", input: z.object({ confirm: z.literal(true) }),
             handler: async (ctx) => ({ reset: (await requireModels(ctx).get("Greeting").updateMany({}, { times_used: 0 })).modifiedCount }) }),
  ],
});
```

`ctx.agent` exists in every process once the ACL is loaded. An agent module
inside the app hands `ctx.agent.manifest(role).tools` to a model as its tool
definitions and routes each call to `ctx.agent.invoke(name, input, actor)`,
which runs the same gate a route has — ACL on the id, then the input schema,
then the handler. For agents outside the process the generated `agent`
module serves the manifest at `GET <prefix>/agent/tools` and runs actions at
`POST <prefix>/agent/tools/<name>`; `tulipes agent manifest` writes the
document from an inspection boot, and
[`@tulipes/mcp`](https://www.npmjs.com/package/@tulipes/mcp) serves it to
Claude Code over MCP through that door.

> [!WARNING]
> **Experimental.** `@tulipes/core/agent`, the manifest's shape, the `agent`
> module's two routes, `tulipes agent manifest` and `@tulipes/mcp` are outside
> the 0.11 compatibility promise: they may change in a patch or minor release
> without a deprecation period, until real use settles them. Everything else
> in 0.11 is covered as usual (see `docs/support.md`).

<details>
<summary><b>Subpath exports</b></summary>

| Import | Contents |
|---|---|
| `@tulipes/core` | everything below |
| `@tulipes/core/boot` | `boot`, `Ctx`, `BootHandle`, contract types |
| `@tulipes/core/env` | `Environment`, `KnownVariables` (codegen target), spec types |
| `@tulipes/core/http` | `HttpError`, `notFoundHandler`, `errorHandler`, `parseRai`, `isRai`, `Rai` |
| `@tulipes/core/acl` | `Acl`, `AclBuilder`, `AclFn`, `RoleMeta`, `RoleRecord`, `RoleDefinition`, `parseRai`, `isRai`, `isGrant` |
| `@tulipes/core/agent` | `defineAgent`, `action`, `AgentRegistry`, `AgentManifest` |
| `@tulipes/testing` | a separate package: `useTestApp`, `bootTestApp`, `TestApp` |
| `@tulipes/core/db` | migration stub only — the Mongoose provider, `ModelStore`, `ModelDef` and `BootstrapFn` live in [`@tulipes/mongoose`](https://www.npmjs.com/package/@tulipes/mongoose) |
| `@tulipes/core/queues` | migration stub only — the BullMQ provider, `QueueManager`, `QueueRegistry` and `QueuesFn` live in [`@tulipes/bullmq`](https://www.npmjs.com/package/@tulipes/bullmq) |
| `@tulipes/core/sockets` | migration stub only — the Socket.IO provider, `SocketManager`, `SocketRegistry` and `SocketsFn` live in [`@tulipes/socket.io`](https://www.npmjs.com/package/@tulipes/socket.io) |
| `@tulipes/core/modules` | module graph, explorer, manifest schema |
| `@tulipes/core/config` | `GlobalConfig` (codegen target), config builder |
| `@tulipes/core/errors` | `TulipesBootError`, `BootReport` |

</details>

## Testing an app

[`@tulipes/testing`](https://www.npmjs.com/package/@tulipes/testing) boots the
app once per test file on a free port, decodes the envelope and signs in as a
role; it takes the runner's file hooks and depends on nothing but core:

```ts
const app = useTestApp({ rootDir, settings: { hello: { greeting: "Hi" } } }, { beforeAll, afterAll });

test("greets", async () => {
  const { status, data } = await app.get<{ message: string }>(app.api("/hello"));
  expect(status).toBe(200);
});

test("the console needs a role", async () => {
  const admin = await app.as("admin");
  expect((await app.get(app.api("/config"), { as: admin })).status).toBe(200);
});
```

A module's tests live in `modules/<name>/tests/`; the generated apps run
them with vitest, one file after another, since every file boots the app
against the same services.

## Generated API documentation

Every route already declares its id, name, description, owning module and
the roles that reach it. Add zod schemas to the same `rai()` and the
framework validates requests against them — then
[`@tulipes/spec`](https://www.npmjs.com/package/@tulipes/spec) turns the
whole registry into an OpenAPI 3.1 document and a Postman collection:

```ts
import { z } from "zod/v4";

router.post(
  `${base}/users`,
  rai({
    id: "users:bo:create",
    name: "Create a user",
    folder: "users",                                    // Postman folder / OpenAPI tag
    body: z.object({ email: z.email("emailInvalid") }),  // validated AND described
    returns: z.object({ id: z.string(), email: z.string() }),
  }),
  users.create(),
);
```

```sh
pnpm add -D @tulipes/spec
pnpm tulipes spec --openapi docs/openapi.json --postman docs/collection.json
```

One declaration validates the request and documents it, so the two cannot
disagree. A rejected field is reported through the normal envelope, and
the zod message doubles as an i18n key — so it arrives in the caller's
language:

```jsonc
{ "success": false, "data": null,
  "errors": [{ "field": "email", "message": "Doit être une adresse email valide",
               "code": "INVALID_FORMAT" }],
  "meta": {} }
```

`tulipes spec` runs the inspection boot: the same routers the app serves,
built with nothing acquired. Use `--url` to set the deployment URL; the
default is `http://localhost:3000`. Routes files are trusted JavaScript, not
a sandbox.

Use `ctx.routes.mount(parent, "/api", childRouter)` for nested routers so the
registry records the full prefix. Each supported HTTP method needs exactly one
`rai()` as its first handler. Middleware remains trusted application code and
can respond before routes. Unsupported path patterns fail with migration guidance.
Each method/URL template has one declaration, including routes that differ only
in parameter names (`/items/:id` and `/items/:name`).

Declare `status: 201` (or another 2xx code) in the RAI when a route creates or
queues work. `res.respond` uses that default and OpenAPI describes it. An explicit
`res.respond({ status })` still overrides the default. Custom access checkers are
reported as dynamic policies in generated documents.

For the move from config factories and lifecycle hooks to settings
declarations and bootstrap cleanups, see [the migration guide](./MIGRATING.md).

## Versioning

`0.10` is the current stable line: its contracts are settled and a breaking
change waits for `0.11`. Before it, `0.x` minors broke freely — `0.2` through
`0.5` each did. The
[CHANGELOG](./CHANGELOG.md) records what changed and
[MIGRATING.md](./MIGRATING.md) gives the upgrade steps, including the one
data migration that can lock users out of an app if it is skipped (the
`snake_case` field rename in `0.5`).

`tulipes update` moves the global CLI and every module manifest together.

## Requirements

Node.js 24.x · Yarn workspaces · MongoDB when an app declares the models
provider, Redis when it declares queues (or uses Redis itself, as the
production preset's cache and rate limiter do).

The stack is deliberately opinionated where it is not optional: **Express 5**
and **Zod** in core, with **i18next** for the translation contract every app
gets. Everything that talks to infrastructure is a provider you select —
**Mongoose 8**, **BullMQ 5**, **Socket.IO 4** — and an app that selects none
installs none of them. A framework that wires everything together can only do
so by choosing; it does not have to make you install the choices you did not
take.

---

<div align="center">
<sub>Built by <b>k13.conf</b> · <a href="https://www.npmjs.com/package/@tulipes/core">npm</a></sub>
</div>
