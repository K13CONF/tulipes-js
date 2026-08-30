# @tulipes/core

**A module-based Express framework: convention-driven boot pipeline, declarative env contracts, ACL, MongoDB, queues, sockets, and a codegen CLI — fail-closed by design.**

Tulipes exists so you never rewrite Express boilerplate again. You write **modules** — self-contained feature folders with routes, models, queues, sockets, and a declared environment contract — and the framework discovers, validates, orders, and wires them into a running API. Everything that can be checked at boot *is* checked at boot, and every failure is reported **in aggregate**: ten missing env variables means one crash listing ten problems, not ten restarts.

```ts
// app.ts — the whole entrypoint
import { boot } from "@tulipes/core/boot";

await boot({ rootDir: import.meta.dirname, mode: "backend" });
```

```
  ▲ my-api  development · backend mode

  ➜  Server     http://localhost:4000  ● listening
  ➜  Database   mongodb://127.0.0.1:27017/my-api  ● connected
  ➜  Queues     1 (users.welcome)  ·  1 processor(s) registered
  ➜  Sockets    /users
  ➜  Modules    4 (core*, security*, auth, users)  ·  * sys tier
  ➜  Roles      2 (admin, user)
  ➜  Runtime    Node v24.14.0  ·  PID 43054  ·  ready in 76ms
```

---

## Why Tulipes

- **Modules, not layers.** A feature lives in one folder: its routes, models, config, permissions, background jobs, and env contract. Delete the folder, the feature is gone.
- **Fail-closed everywhere.** Missing env vars, dependency cycles, duplicate ACL grants, colliding queue names — all crash the boot with a full report. Reading an undeclared variable or model throws at the call site. Unknown roles deny. Unrouted requests 404. Unexpected errors never leak internals outside development.
- **One codebase, three modes.** The same app boots as a `backend` server, a queue-consuming `worker`, or a one-shot `script` — same modules, same config, forked at the last pipeline phase. A maintenance script therefore runs against exactly the configuration the server has, never a hand-rolled approximation of it.
- **Types generated, not hand-written.** `tulipes sync` reads your modules and emits a `config.d.ts` that types every env variable and every config namespace — enum variables become literal unions, config shapes are inferred from your factories' return types.
- **The framework stays out of your request path.** Core mounts *no* middleware. Your sys-tier modules own the pipeline head; core only guarantees the tail (404 + terminal error handler).

## Requirements

- Node.js ≥ 20.11 (ESM, `import.meta.dirname`)
- Yarn workspaces (modules are workspace packages)
- MongoDB and Redis, when your modules use models/queues

## Installation

```sh
yarn add @tulipes/core
```

## Application layout

```
my-api/
├── app.ts                  # boot({ mode: "backend" })
├── worker.ts               # boot({ mode: "worker" })
├── config/
│   └── app.config.ts       # optional: seeds global config before any module
├── lib/                    # your cross-cutting glue (cache, mongoose plugins…)
├── modules/                # ← the application
│   ├── core/               # sys tier: infra env vars, roles, global middleware
│   ├── security/           # sys tier: headers, logging, body parsing
│   └── users/              # app tier: a feature
├── types/config.d.ts       # GENERATED — tulipes sync
├── .env.example            # GENERATED — tulipes sync
├── .envs/
│   └── .env.development    # per-mode env files, picked by APP_ENV
└── package.json            # "workspaces": ["modules/*"]
```

## Module anatomy

Every module is a yarn workspace package under `modules/`. Every file below is optional except `package.json`.

```
modules/users/
├── package.json            # name + "tulipes" ordering key
├── meta.variables.json     # the module's env contract
├── module.config.ts        # config factory + onReady/onShutdown hooks
├── module.acl.ts           # permission grants
├── routes/*.routes.ts      # (ctx) => Router
├── models/*.model.ts       # { name, schema }
├── bootstrap/*.bootstrap.ts# post-DB, pre-server tasks (indexes, seeds)
├── queues/*.queues.ts      # (ctx, queues) => define + process
├── sockets/*.sockets.ts    # (ctx, sockets) => claim namespaces
└── controllers/            # convention only — routes import them directly
```

```json
{
  "name": "@app/users",
  "tulipes": { "tier": "app", "priority": 10, "dependsOn": ["auth"] },
  "dependencies": { "@app/auth": "workspace:*" }
}
```

**Load order** is three sort keys: tier (`sys` before `app`) → `priority` (lower first, default 100) → topological sort on `dependsOn`. Cycles, unknown dependencies, and a sys module depending on an app module all crash the boot. Cross-module imports go through package names, so the package manager enforces that a module only uses what it declares.

## The environment contract

Each module declares its variables in `meta.variables.json` — plain JSON so tooling can read it without executing code:

```json
{
  "variables": [
    {
      "name": "USERS_SIGNUP_MODE",
      "type": "enum",
      "enum": ["open", "invite", "closed"],
      "group": "signup",
      "description": "Who can register",
      "default": "open"
    },
    {
      "name": "USERS_ADMIN_EMAIL",
      "type": "string",
      "required": true,
      "description": "Seeded admin account email"
    }
  ]
}
```

| Field | Rules |
|---|---|
| `name` | UPPER_SNAKE. **One owner per variable across the app** — two modules declaring the same name is a boot crash naming both. Shared infra vars (`MONGO_URI`, `REDIS_URL`, `PORT`) belong to your sys core module. |
| `type` | `string` · `number` · `boolean` · `enum` · `url` · `secret` (redacted in every log, banner, and report) |
| `enum` | required with `type: "enum"` |
| `required` | no resolved value → boot crash; mutually exclusive with `default` |
| `default` | used when nothing else provides a value |
| `group` | free-form label; drives section grouping in the generated `.env.example` |

Resolution precedence: **`process.env` › `.envs/.env.<APP_ENV>` › `default`** — container-injected values always win. The mode comes from `APP_ENV` (`development` / `staging` / `production` / `test`), deliberately not `NODE_ENV` (core mirrors a sane `NODE_ENV` for third-party libraries).

Values are validated and coerced (`"5"` → `5`, `"true"` → `true`, enum membership, URL shape). Reads are typed after codegen and fail-closed always:

```ts
ctx.Environment.get("USERS_SIGNUP_MODE"); // "open" | "invite" | "closed"
ctx.Environment.get("TYPO_NAME");         // throws: never declared by any module
```

## The boot pipeline

```
 1. Environment      load .env.<APP_ENV>, every meta.variables.json → validate (aggregate crash)
 2. Module graph     read "tulipes" keys → tier/priority/topo sort (cycles crash)
 3. Exploration      resolve conventional file paths, load order, no imports yet
 4. Global config    config/app.config.ts seed → each module.config.ts factory,
                     in load order (each factory sees its dependencies' config)
 5. ACL merge        module.acl.ts in load order (conflicts crash)
 6. Database         connect Mongoose → model store → bootstrap tasks
 7. Queues           every *.queues.ts registers in BOTH modes
 8. ── mode fork ──
    backend          module routers (load order) → 404 → error handler → listen
    worker           start a BullMQ worker per registered processor
    script           start nothing; the caller owns the process and calls
                     handle.shutdown() when done (also skips bootstrap
                     tasks, the banner and onReady)
 9. onReady          hooks in load order → startup banner
    shutdown         SIGTERM/SIGINT → onShutdown hooks in REVERSE order →
                     disconnect sockets → close http → drain queues → close redis → close mongo
```

Each phase crashes with its own aggregate report before the next begins. In dev the pipeline discovers `.ts` files (run under tsx); compiled deployments discover `.js` — detected automatically.

## Contracts

Everything a module exports receives the shared context:

```ts
interface Ctx {
  Environment: Environment;   // typed variable store
  config: GlobalConfig;       // namespaced by module: config.users
  acl?: Acl;                  // after phase 5
  models?: ModelStore;        // after phase 6
  queues?: QueueManager;      // after phase 7
  sockets?: SocketManager;    // backend only
  app?: Express;              // backend only
}
```

```ts
// module.config.ts — namespace stored at config.<module>; hooks optional
export default function usersConfig({ Environment }: Ctx) {
  return { maxSessions: Environment.get("USERS_MAX_SESSIONS") };
}
export async function onReady(ctx: Ctx) {}
export async function onShutdown(ctx: Ctx) {}   // runs in reverse load order

// routes/users.routes.ts — return a Router, or mount on ctx.app directly
export default function usersRoutes({ config, models }: Ctx): Router {
  const router = Router();
  router.get("/users", async (_req, res) => {
    res.json(await models!.get("User").find().lean());
  });
  return router;
}

// models/user.model.ts — pure definition, no factory
export default { name: "User", schema: userSchema } satisfies ModelDef;

// bootstrap/seed-admin.bootstrap.ts — post-DB, pre-server; make it idempotent
export default async function seedAdmin({ models, Environment }: Ctx) {}

// queues/users.queues.ts — ONE file for both process modes
export default function usersQueues(_ctx: Ctx, queues: QueueRegistry) {
  queues.define("users.welcome");                       // producers, every mode
  queues.process("users.welcome", async (job) => {});   // consumed in worker mode
}

// sockets/users.sockets.ts — claim a namespace exactly once
export default function usersSockets(_ctx: Ctx, sockets: SocketRegistry) {
  sockets.namespace("/users", (nsp) => {
    nsp.on("connection", (socket) => socket.emit("welcome"));
  });
}

// module.acl.ts — roles are global (define in your sys module), grants are local
export default function usersAcl(acl: AclBuilder) {
  acl.allow("user", "users:read");        // resources namespaced by module
}
```

Producing a job from anywhere: `await ctx.queues.add("users.welcome", "welcome", { email })`.
Emitting from anywhere: `ctx.sockets.of("/users").emit("event", data)` — unclaimed namespaces throw.

## Global middleware

Core mounts nothing. Sys modules load before every app module, so a sys module's routes file mounting on `ctx.app` **is** the "before all routes" slot:

```ts
// modules/security/routes/security.routes.ts   (tier: "sys")
export default function securityRoutes({ app }: Ctx): void {
  app!.use(securityHeaders());
  app!.use(pinoHttp({ /* … */ }));
  app!.use(express.json({ limit: "1mb" }));
}
```

Core guarantees only the fail-closed tail: a 404 for anything unrouted, and a terminal error handler that catches thrown/rejected async handlers. Modules signal errors with one class:

```ts
import { HttpError } from "@tulipes/core/http";

router.get("/users/:id", async (req) => {
  const user = await findUser(req.params.id);
  if (!user) throw new HttpError(404, "no such user", { id: req.params.id });
});
```

`HttpError` renders `{ error, details? }` with its status. Errors raised by express middleware that carry a 4xx `status` are honored too — an oversized body stays a `413`, malformed JSON a `400` — since those describe the caller's request, not your internals. Everything else becomes an anonymous `500 internal server error`, with the real message only in `development`/`test`.

## The CLI

```
tulipes init [dir]           scaffold a new application (needs mongo + redis)
tulipes sync                 regenerate types/config.d.ts and .env.example
tulipes env:check            validate env against every meta contract — CI gate, exit 1 on failure
tulipes new module <name>    scaffold a module (scope auto-detected from siblings)
tulipes update               upgrade the global cli and, inside an app, the app itself
tulipes -v                   print the cli version (and the app's, when they differ)
tulipes dev [entry]          sync, then run the entry under tsx watch
```

The scaffolded `modules/hello` is a worked example of every module
contract — config factory with lifecycle hooks, ACL grants, routes with
`HttpError` and permission checks, a controller, a pure helper, a model,
an idempotent bootstrap task, a queue with its processor, and a socket
namespace. The generated app expects mongo and redis to be running.

### Built for AI-assisted work

`tulipes init` also writes a `CLAUDE.md` and eight task-scoped skills under
`.claude/skills/` — module, env variable, endpoint, model, queue, socket,
permissions, and reading boot errors. They encode the conventions an agent
would otherwise guess wrong: declaring variables instead of reaching for
`process.env`, where global middleware belongs, why `mongoose.model()` is
never called directly, and how to read an aggregate boot report.

The global CLI on your PATH and the `@tulipes/core` an app installs are
**separate installs** that drift apart. `tulipes update` handles both: it
reinstalls the global CLI into the prefix it already lives in (which is what
makes it work under nvm, where a plain `npm install -g` may target a
different node version than the one holding your `tulipes` binary), and,
when run inside an app, rewrites the range in the app root and every module
before installing. Outside an app it still updates the CLI. `tulipes -v`
prints both numbers whenever they differ.

`sync` output — committed, marked generated:

- **`types/config.d.ts`** — augments `KnownVariables` (every variable typed from its spec) and `GlobalConfig` (each namespace typed as its factory's return type via `typeof import(...)` — inference, never execution).
- **`.env.example`** — every variable with description, type, `REQUIRED` markers, grouped by module and `group`.

## Subpath exports

| Import | Contents |
|---|---|
| `@tulipes/core` | everything below |
| `@tulipes/core/boot` | `boot`, `BootOptions`, `BootHandle`, `Ctx`, contract types |
| `@tulipes/core/env` | `Environment`, `KnownVariables` (codegen target), spec types |
| `@tulipes/core/http` | `HttpError`, `notFoundHandler`, `errorHandler` |
| `@tulipes/core/acl` | `Acl`, `AclBuilder`, `AclFn` |
| `@tulipes/core/db` | `ModelStore`, `ModelDef`, `BootstrapFn` |
| `@tulipes/core/queues` | `QueueManager`, `QueueRegistry`, `QueuesFn` |
| `@tulipes/core/sockets` | `SocketManager`, `SocketRegistry`, `SocketsFn` |
| `@tulipes/core/modules` | module graph, explorer, manifest schema |
| `@tulipes/core/config` | `GlobalConfig` (codegen target), config builder |
| `@tulipes/core/errors` | `TulipesBootError`, `BootReport` |

## The committed stack

Express 5 · Mongoose 8 · BullMQ 5 · ioredis 5 · Socket.IO 4 · Zod. Deliberately opinionated in v1 — a framework that wires everything can only do so by choosing.

## Well-known variables

Core reads three variable names when present (declare them in your sys core module): `PORT` (backend listen port, default 3000), `MONGO_URI` (required if any module ships models), `REDIS_URL` (required if any module ships queues). No models and no `MONGO_URI` is a valid database-less app; models without `MONGO_URI` is a boot refusal.
