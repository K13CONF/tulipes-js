```
                         ██▄      ▄██▄      ▄██
                          ██▄    ▄████▄    ▄██
                          ████▄▄████████▄▄████
                           ██████████████████
                           ▀████████████████▀
                            ▀██████████████▀
                             ▀████████████▀
                              ▀██████████▀
                                 ▀▀██▀▀
                                   ██
                             ▄▄▄   ██   ▄▄▄
                          ▄██▀     ██     ▀██▄
                         ▀▀        ██        ▀▀
                                   ██

████████╗██╗   ██╗██╗     ██╗██████╗ ███████╗███████╗     ██╗███████╗
╚══██╔══╝██║   ██║██║     ██║██╔══██╗██╔════╝██╔════╝     ██║██╔════╝
   ██║   ██║   ██║██║     ██║██████╔╝█████╗  ███████╗     ██║███████╗
   ██║   ██║   ██║██║     ██║██╔═══╝ ██╔══╝  ╚════██║██   ██║╚════██║
   ██║   ╚██████╔╝███████╗██║██║     ███████╗███████║╚█████╔╝███████║
   ╚═╝    ╚═════╝ ╚══════╝╚═╝╚═╝     ╚══════╝╚══════╝ ╚════╝ ╚══════╝
                                                             k13.conf
```

<div align="center">

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

```sh
npm install -g @tulipes/core
tulipes init my-api && cd my-api

corepack enable      # once per machine — activates the pinned yarn 4
yarn install
yarn dev             # → http://localhost:3000/api/v1/hello
```

You get a running API with three modules, a queue worker, websockets, PM2
process definitions, nginx templates and agent instructions. It expects
MongoDB and Redis; both are declared in the generated environment contract.

```
  ▲ my-api  development · backend mode

  ➜  Server     http://localhost:3000  ● listening
  ➜  Database   mongodb://127.0.0.1:27017/my-api  ● connected
  ➜  Queues     1 (hello.count-greeting)  ·  1 processor(s) registered
  ➜  Sockets    /hello
  ➜  Modules    3 (core*, security*, hello)  ·  * sys tier
  ➜  Roles      2 (admin, user)
  ➜  Runtime    Node v24.14.0  ·  PID 43054  ·  ready in 61ms
```

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
├── module.config.ts          config factory + onReady / onShutdown
├── module.acl.ts             permission grants
├── routes/*.routes.ts        (ctx) => Router
├── controllers/              the work; routes import it directly
├── helpers/                  pure logic, no framework
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

## The boot pipeline

```
 1  Environment      .env.<APP_ENV> + every meta.variables.json → validate
 2  Module graph     "tulipes" keys → tier / priority / topological sort
 3  Exploration      resolve conventional paths in load order, import nothing
 4  Global config    config/app.config.ts seed → each module.config.ts factory
 5  ACL              module.acl.ts in load order
 6  Database         connect → model store → bootstrap tasks
 7  Queues           every *.queues.ts registers, in all modes
 8  ── fork ──
    backend          module routers → 404 → error handler → listen
    worker           one BullMQ worker per registered processor
    script           start nothing; the caller owns the process
 9  onReady          hooks in load order → startup banner
    shutdown         SIGTERM → onShutdown in REVERSE order → sockets →
                     http → queues → redis → mongo
```

Each phase crashes with its own aggregate report before the next begins.

<details>
<summary><b>Contracts — what each file exports</b></summary>

```ts
interface Ctx {
  mode: ProcessMode;        // "backend" | "worker" | "script"
  rai: (info: RouteInfo) => RequestHandler;  // declare + gate an endpoint
  routes: RouteRegistry;    // every declared endpoint
  Environment: Environment; // typed variable store
  config: GlobalConfig;     // namespaced by module: config.billing
  acl?: Acl;                // after phase 5
  models?: ModelStore;      // after phase 6
  queues?: QueueManager;    // after phase 7
  sockets?: SocketManager;  // backend only
  app?: Express;            // backend only
}

// module.config.ts — the namespace stored at config.<module>
export default function billingConfig({ Environment }: Ctx) {
  return { trialDays: Environment.get("BILLING_TRIAL_DAYS") };
}
export async function onReady(ctx: Ctx) {}
export async function onShutdown(ctx: Ctx) {}    // reverse load order

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

// models/*.model.ts — a declaration; never call mongoose.model() yourself
export default { name: "Invoice", schema } satisfies ModelDef;

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
| `tulipes init [dir]` | scaffold a new application |
| `tulipes dev [entry]` | regenerate types, then run under tsx watch |
| `tulipes sync` | regenerate `types/config.d.ts` and `.env.example` |
| `tulipes env:check` | validate the environment without booting — a CI gate |
| `tulipes routes` | list every endpoint with its RAI and the roles that reach it |
| `tulipes new module <name>` | scaffold a module with every contract |
| `tulipes update` | upgrade the global CLI and, inside an app, the app itself |
| `tulipes -v` | print the CLI version, and the app's when they differ |

`update` handles two separate installs: the global `tulipes` on your PATH, and
the `@tulipes/core` an app depends on — including every module, since modules
declare it themselves. It reinstalls the CLI into the prefix it already lives
in, which is what makes it work under nvm, where a plain `npm install -g` may
target a different Node version than the one holding your binary.

## What `tulipes init` gives you

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
| `@tulipes/core/db` | `ModelStore`, `ModelDef`, `BootstrapFn` |
| `@tulipes/core/queues` | `QueueManager`, `QueueRegistry`, `QueuesFn` |
| `@tulipes/core/sockets` | `SocketManager`, `SocketRegistry`, `SocketsFn` |
| `@tulipes/core/modules` | module graph, explorer, manifest schema |
| `@tulipes/core/config` | `GlobalConfig` (codegen target), config builder |
| `@tulipes/core/errors` | `TulipesBootError`, `BootReport` |

</details>

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
