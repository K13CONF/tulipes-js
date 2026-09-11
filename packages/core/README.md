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

Requires Node 24.x and Corepack. Tulipes is experimental; see the
[compatibility policy](../../docs/support.md).

```sh
npm install -g @tulipes/core@next
tulipes init my-api
cd my-api
corepack enable
yarn install
yarn sync
yarn typecheck
yarn check
yarn test
yarn spec
yarn dev
```

Open http://localhost:3000/api/v1/hello or http://localhost:3000/health.
The default minimal preset contains core, security middleware and a hello
module with tests. It requires no MongoDB, Redis or credentials. `--minimal`
and `--preset minimal` select the same starter.

For authentication, users, settings, database/queues, sockets and deployment
examples, use `tulipes init my-api --preset production`. That preset requires
MongoDB and Redis. Its generated README explains environment setup and tests.
Core still installs infrastructure libraries in both presets; provider package
extraction is planned separately.

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
emits a `config.d.ts`: enum variables become literal unions, config namespaces
are inferred from your factories' return types.

**The framework stays out of your request path.** Core mounts *no* middleware.
Your sys-tier modules own the head of the pipeline; core guarantees only the
fail-closed tail — a 404 for anything unrouted, and a terminal error handler.

## A module

Every module is a workspace package under `modules/`. Every file is optional
except `package.json` — `tulipes new module <name>` generates them all, so you
delete what this feature does not need.

```
modules/billing/
├── package.json              name + "tulipes" ordering key
├── meta.variables.json       this module's environment contract
├── module.config.ts          config factory + onReady / onDrain / onShutdown
├── module.acl.ts             permission grants
├── routes/*.routes.ts        native Router factories, optionally wrapped in defineRoutes
├── controllers/              the work; handler factories import it lazily
├── helpers/                  pure logic, no framework
├── i18n/<locale>.json        this module's strings — the module is the namespace
├── models/*.model.ts         { name, schema } — a declaration, not a registration
├── bootstrap/*.bootstrap.ts  post-database, pre-traffic: indexes, seeds
├── queues/*.queues.ts        (ctx, queues) => define + process
└── sockets/*.sockets.ts      (ctx, sockets) => claim a namespace
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

## The boot pipeline

```
 1  Environment      .env.<APP_ENV> + every meta.variables.json → validate
 2  Module graph     "tulipes" keys → tier / priority / topological sort
 3  Exploration      resolve conventional paths in load order, import nothing
 4  Global config    config/app.config.ts seed → each module.config.ts factory
 5  Translations     modules/*/i18n/*.json, one namespace per module
 6  ACL              module.acl.ts in load order
 7  Database         connect → model store → bootstrap tasks
 8  Queues           every *.queues.ts registers, in all modes
 9  ── fork ──
    backend          module routers → 404 → error handler → listen
    worker           one BullMQ worker per registered processor
    script           start nothing; the caller owns the process
10  onReady          hooks in load order → startup banner
    shutdown         SIGTERM → onDrain + stop/drain http + sockets + workers →
                     onShutdown in REVERSE order → queues → redis → mongo
```

Each phase crashes with its own aggregate report before the next begins.
`onDrain` hooks start in reverse module order before traffic drain actions;
asynchronous hooks and traffic drain concurrently under the same shutdown deadline.
Keep dependencies available until `onShutdown`. Failed/timed-out notifications are
aggregated and do not prevent later cleanup attempts.

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
  queues?: QueueManager;    // after phase 8
  sockets?: SocketManager;  // backend only
  app?: Express;            // backend only
}

// module.config.ts — the namespace stored at config.<module>
export default function billingConfig({ Environment }: Ctx) {
  return { trialDays: Environment.get("BILLING_TRIAL_DAYS") };
}
export async function onReady(ctx: Ctx) {}
export async function onDrain(ctx: Ctx) {}       // signal long-lived work to stop
export async function onShutdown(ctx: Ctx) {}    // dispose after draining, reverse order

// routes/*.routes.ts — every route declares a RAI, or the boot fails
export default function billingRoutes(ctx: Ctx): Router {
  const router = Router();
  const billing = new BillingController(ctx);   // controllers are classes

  router.get(
    `${ctx.config.api!.prefix}/invoices`,
    ctx.rai({ id: "invoices:read", name: "List invoices" }),
    billing.list(),
  );
  return router;
}

// models/*.model.ts — a declaration; never call mongoose.model() yourself.
// Needs the app to declare its models provider in package.json:
//   "tulipes": { "providers": { "models": "@tulipes/mongoose" } }
export default { name: "Invoice", schema } satisfies ModelDef; // ModelDef from @tulipes/mongoose

// bootstrap/*.bootstrap.ts — runs in every process, so make it idempotent
export default async function seed({ models }: Ctx) {}

// queues/*.queues.ts — ONE file, both sides; the process mode decides
export default function billingQueues(ctx: Ctx, queues: QueueRegistry) {
  queues.define("billing.send-invoice");                     // producers, always
  queues.process("billing.send-invoice", async (job) => {}); // consumed in worker
}

// sockets/*.sockets.ts — a namespace is claimed by exactly one module
export default function billingSockets(ctx: Ctx, sockets: SocketRegistry) {
  sockets.namespace("/billing", (nsp) => nsp.on("connection", () => {}));
}

// module.acl.ts — roles are global, grants are local and namespaced
export default function billingAcl(acl: AclBuilder) {
  acl.allow("user", "invoices:read");
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

| Command | What it does |
|---|---|
| `tulipes init [dir] [--minimal \| --preset minimal \| --preset production]` | scaffold an application; no services |
| `tulipes dev [entry]` | regenerate types, then run under tsx watch |
| `tulipes sync` | regenerate `types/config.d.ts` and `.env.example` |
| `tulipes env:check` | validate the environment without booting — a CI gate |
| `tulipes routes [--offline \| --runtime]` | inspect shared declarations offline or runtime endpoints |
| `tulipes spec [--offline \| --runtime] [--openapi file] [--postman file] [--url base]` | generate specs from the selected inspection mode |
| `tulipes new module <name>` | scaffold a module with every contract |
| `tulipes update` | upgrade the global CLI and, inside an app, the app itself |
| `tulipes -v` | print the CLI version, and the app's when they differ |

`update` handles two separate installs: the global `tulipes` on your PATH, and
the `@tulipes/core` an app depends on — including every module, since modules
declare it themselves. It reinstalls the CLI into the prefix it already lives
in, which is what makes it work under nvm, where a plain `npm install -g` may
target a different Node version than the one holding your binary.

`init`, `sync`, `env:check`, `new module`, version and update commands do not
connect application infrastructure (`update` uses the package registry). `dev`
boots the application and requires its declared services. `routes` and `spec`
default to runtime inspection, which connects configured infrastructure and runs
config/route factories and shutdown hooks, while skipping bootstrap, sockets,
listening and readiness. `--offline` builds opted-in native routers and loads ACL
without services, runtime config or secrets. Both new presets use it in `yarn spec`.
See [offline inspection](../../docs/offline-inspection.md) for migration and limits.
This interface is available in core `0.9.0-rc.3` and later candidates; use
`@tulipes/core@next` with `@tulipes/spec@next`.

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

`tulipes init` also writes a `CLAUDE.md` and eight task-scoped skills under
`.claude/skills/` — module, environment variable, endpoint, model, queue,
socket, permissions, and reading boot errors. They encode the conventions an
agent would otherwise guess wrong: declaring variables instead of reaching for
`process.env`, why `mongoose.model()` is never called directly, where global
middleware belongs, and how to read an aggregate boot report.

<details>
<summary><b>Subpath exports</b></summary>

| Import | Contents |
|---|---|
| `@tulipes/core` | everything below |
| `@tulipes/core/boot` | `boot`, `Ctx`, `BootHandle`, contract types |
| `@tulipes/core/env` | `Environment`, `KnownVariables` (codegen target), spec types |
| `@tulipes/core/http` | `HttpError`, `notFoundHandler`, `errorHandler` |
| `@tulipes/core/acl` | `Acl`, `AclBuilder`, `AclFn` |
| `@tulipes/core/db` | migration stub only — the Mongoose provider, `ModelStore`, `ModelDef` and `BootstrapFn` live in [`@tulipes/mongoose`](https://www.npmjs.com/package/@tulipes/mongoose) |
| `@tulipes/core/queues` | `QueueManager`, `QueueRegistry`, `QueuesFn` |
| `@tulipes/core/sockets` | `SocketManager`, `SocketRegistry`, `SocketsFn` |
| `@tulipes/core/modules` | module graph, explorer, manifest schema |
| `@tulipes/core/config` | `GlobalConfig` (codegen target), config builder |
| `@tulipes/core/errors` | `TulipesBootError`, `BootReport` |

</details>

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
    id: "users:create",
    name: "Create a user",
    folder: "users",                                    // Postman folder / OpenAPI tag
    body: z.object({ email: z.email("emailInvalid") }),  // validated AND described
    returns: z.object({ id: z.string(), email: z.string() }),
  }),
  users.create(),
);
```

```sh
yarn add -D @tulipes/spec
yarn tulipes spec --openapi docs/openapi.json --postman docs/collection.json
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

`--offline` builds the same `defineRoutes()` router trees used at runtime,
without acquiring callbacks registered through `runtime()` or connecting services. Use `--url` to set the deployment
URL; offline defaults to `http://localhost:3000` and package.json title/version.
The default `--runtime` path retains infrastructure-backed inspection for legacy
factories. Declaration imports remain trusted JavaScript, not a sandbox.

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

For lifecycle timing changes and the more precise `ConfigCtx`, `BackendCtx` and
`DatabaseCtx` contracts, see [the migration guide](./MIGRATING.md).

## Versioning

`0.x`, and a minor bump may break — `0.2` through `0.5` each did. The
[CHANGELOG](./CHANGELOG.md) records what changed and
[MIGRATING.md](./MIGRATING.md) gives the upgrade steps, including the one
data migration that can lock users out of an app if it is skipped (the
`snake_case` field rename in `0.5`).

`tulipes update` moves the global CLI and every module manifest together.

## Requirements

Node.js ≥ 20.11 · Yarn workspaces · MongoDB and Redis when your modules use
models or queues.

The stack is deliberately opinionated in v1: **Express 5 · Mongoose 8 ·
BullMQ 5 · ioredis 5 · Socket.IO 4 · Zod**. A framework that wires everything
together can only do so by choosing.

---

<div align="center">
<sub>Built by <b>k13.conf</b> · <a href="https://www.npmjs.com/package/@tulipes/core">npm</a></sub>
</div>
