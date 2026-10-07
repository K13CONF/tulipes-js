# tulipes-example

A production-preset [Tulipes](https://www.npmjs.com/package/@tulipes/core) application. Requires Node 24.x.

## Run

```sh
npm install -g pnpm   # once per machine
pnpm install
pnpm dev          # boot the backend process → http://localhost:3000/api/v1/hello
```

Needs mongo and redis running — see `MONGO_URI` and `REDIS_URL` in
`.envs/.env.development`. Run `pnpm worker` in a second terminal to
consume queued jobs.

`.envs/` is git-ignored: those files hold working credentials. On a
fresh clone there is nothing in it, so copy `.env.example` — which is
committed, and which `pnpm sync` regenerates from every module's
declared variables — and fill it in:

```sh
pnpm sync                              # refresh .env.example and types
mkdir -p .envs                         # git does not track empty dirs
cp .env.example .envs/.env.development
pnpm check                             # validate it without booting
```

## Verify

Run `pnpm sync`, `pnpm typecheck` and `pnpm check`. Tests need dedicated
services: `TEST_MONGO_URI=mongodb://127.0.0.1:27017/tulipes_tests TEST_REDIS_URL=redis://127.0.0.1:6379/3 pnpm test`.
Use test-only data: the suite creates users and sessions. `pnpm spec` writes
OpenAPI/Postman documents offline, without services or runtime secrets.
Change the shared API prefix in `config/routes.ts`. Runtime middleware stays
with endpoints in `routes/*.routes.ts`, plain functions of the context.
Staging/production boot rejects development credentials and equal JWT keys.
Auth, settings and deployment examples are application policy you own.

## The hello module

`modules/hello` is a worked example of every module contract — read it
before writing your own:

| File | Contract |
|---|---|
| `package.json` `tulipes.env` | the module's environment contract |
| `module.config.ts` | `defineConfig({ schema })`: this module's settings |
| `module.acl.ts` | permission grants on `hello:*` |
| `routes/*.routes.ts` | native routers, shared middleware and RAI schemas |
| `controllers/` | the work; constructed from the context while routes build |
| `helpers/` | pure logic, no framework |
| `i18n/<locale>.json` | this module's strings — the module is the namespace |
| `sockets/*.sockets.ts` | a claimed Socket.IO namespace | <!-- feature:sockets -->
| `models/*.model.ts` | a schema declaration for the model store |
| `bootstrap/*.bootstrap.ts` | idempotent seeding, before traffic |
| `queues/*.queues.ts` | a job definition and its processor | <!-- feature:queues -->

## Daily commands

| command | does |
|---|---|
| `pnpm dev` | regenerate types, run backend process under tsx watch |
| `pnpm worker` | run the queue-consumer process (needs a queue first) | <!-- feature:queues -->
| `pnpm sync` | regenerate `types/config.d.ts` + `.env.example` |
| `pnpm check` | validate env against every module contract — CI gate |
| `pnpm tulipes new module <name>` | scaffold a module |
| `pnpm tulipes update` | upgrade the framework everywhere it is declared |

## Authentication

`modules/auth` is sys tier, so it resolves the caller before any
feature route runs. A request with no valid token is not rejected — it
becomes the **guest** caller, which is what makes a public endpoint
an ordinary ACL grant instead of a second mechanism:

```ts
acl.allow("guest", "auth:login");   // that is why login is reachable
```

Guarding is the RAI itself — its `id` IS the permission, so there is
no second call to forget. 401 means "sign in"; 403 means "signed in,
still not allowed":

```ts
router.get(
  `${base}/invoices`,
  rai({ id: "invoices:read", name: "List invoices" }),
  billing.list(),
);
```

A route that declares no RAI would be reachable by guest, so core
scans the router stack after mounting and refuses to boot when it
finds one. Run `pnpm tulipes routes` to see every endpoint with the
roles that reach it.

Try it — the admin comes from AUTH_ADMIN_EMAIL / AUTH_ADMIN_PASSWORD:

```sh
curl -X POST localhost:3000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"dev-admin-password"}'

curl localhost:3000/api/v1/auth/me -H "authorization: Bearer <accessToken>"
```

Inside a handler, the caller is `req.auth` — resolved before any
feature route and never undefined inside a declared one:

```ts
const { isAuthenticated, user, session } = req.auth;
user?.email          // the hydrated user document, null for a guest
session?.sid         // this device's session row, null for a guest
```

Never re-parse the Authorization header: the pipeline already did,
and it reloads the user on every request so a demotion or a ban takes
effect immediately rather than whenever the token expires.

Sessions are rows, so a signed-in account can see and end its own
devices — `GET /auth/sessions`, `DELETE /auth/sessions/:sid`. Ending
one takes effect on the next request that device makes, even though
its access token is still signed and unexpired.

Passwords never touch the User document: the hash lives in the auth
module's `Credential` model, `select: false`, so a route that
serialises a user cannot leak one. Refresh tokens rotate on use;
logout deletes the refresh row and blacklists the access token's jti
until it expires; a password change moves a per-user epoch that
invalidates every token issued before it. Both token collections carry
TTL indexes.

## Logging

The logger lives in the core module and is shared by every other one:

```ts
import { moduleLogger } from "@app/core";

const log = moduleLogger(ctx.Environment, "billing", ctx.mode);
log.info({ invoiceId }, "invoice sent");
```

It writes to two destinations at once, because they answer different
questions: a **coloured, human-readable** stream on the console, and
**JSON lines** in `logs/` — one object per line, which is what makes
them greppable with jq or ingestible by a collector. Errors are
additionally copied to their own file, so the first thing to open when
something breaks is small.

Files carry the process mode — `app-backend.log`, `app-worker.log` —
because backend and worker run at the same time and two processes
rotating one file will race.

Everything is configured from `modules/core/meta.variables.json`:
`LOG_LEVEL`, `LOG_CONSOLE`, `LOG_FILE`, `LOG_DIR`, `LOG_BASENAME`,
`LOG_ERROR_BASENAME`, and rotation via `LOG_ROTATION_FREQUENCY`,
`LOG_ROTATION_SIZE` and `LOG_RETENTION_FILES` (how many rotated files
to keep). Rotation happens on whichever of frequency or size trips
first.

## Responses

Every endpoint answers with one envelope, so a client unwraps once:

```jsonc
{ "success": true, "data": { }, "errors": [], "meta": {} }
```

`res.respond` builds it. Express is untouched — `res.json` and
`res.status` behave exactly as they always did:

```ts
res.respond({ data: user });
res.respond({ data: user, status: 201 });
res.respond({ data: items, meta: { total_items } });   // paginated
```

Failures are **thrown**, never responded — the framework's terminal
handler builds the same envelope from them, so a handler only writes
the happy path. The message is an i18n key: it gets translated in the
module's namespace and the error code is derived from it.

```ts
throw new HttpError(404, "notFound");                   // → NOT_FOUND
throw new HttpError(422, "emailTaken", { field: "email" });
```

`req.page` is already parsed from `?page` / `?per_page` and clamped
by `config.pagination`; passing `total_items` is what marks a
response as a page and fills in `total_pages`.

In development, a route answering without `res.respond` logs a
warning naming it.

## Browser authentication

Read [Browser authentication and cookies](docs/browser-auth.md) before wiring
up a browser client. The starter uses Bearer headers and JSON refresh tokens;
CORS settings do not install cookie authentication or CSRF protection.

## Translations

Each module owns its strings and IS its own i18n namespace:
`modules/hello/i18n/en.json`, `fr.json`. Inside an endpoint `req.t`
is already bound to the module that declared the route — `rai()` binds
it — so there is nothing to import and no namespace to name:

```ts
res.json({ message: req.t("created", { email }) });
throw new HttpError(404, req.t("notFound"));
```

The locale is `?lang=fr`, else Accept-Language, else
`config.i18n.defaultLocale` — narrowed to `supportedLocales`:

```sh
curl 'localhost:3000/api/v1/hello/secret?lang=fr' -H "authorization: Bearer <token>"
```

Code with no request names both: `ctx.t("users", recipient.locale)`,
which is how a queue processor translates against the recipient's
locale rather than the enqueuer's — so put the locale in the job.

Only the default locale must be complete. Anything another locale
lacks falls back to it and is listed in `<locale>.missing.json` beside
it on the next boot — git-ignored, and never written in production.

## Scripts

`scripts/` holds one-off tasks — backfills, exports, admin chores.
They boot the app in **script mode**, which runs every phase the
backend runs and then starts no server, so a script gets exactly what
a route handler gets: config, ACL, models, queue producers.

```sh
pnpm script scripts/count-greetings.ts
```

Copy the try/finally from `scripts/count-greetings.ts`: mongo and
redis hold the event loop open, so a script that forgets
`handle.shutdown()` prints its output and then hangs.

## Deploying nginx

`nginx/{development,staging,production}.conf` are templates with
`{{DOMAIN}}` and `{{PORT}}` placeholders. The deploy script renders
the one matching `APP_ENV`, using that same environment's
`PUBLIC_DOMAIN` and `PORT`, so template, domain and port can never
disagree:

```sh
APP_ENV=production pnpm script scripts/deploy-nginx.ts --dry-run
sudo -E APP_ENV=production pnpm script scripts/deploy-nginx.ts
```

It writes `sites-available/<domain>`, links `sites-enabled`, runs
`nginx -t`, then reloads. It refuses when not root, while
`PUBLIC_DOMAIN` is still `localhost`, or when the conf already exists
(pass `--force` to overwrite one). Debian/Ubuntu layout.

The rendered conf is HTTP-only with the TLS block commented out —
`nginx -t` fails on certificate paths that do not exist yet, which
would make the first deploy impossible. Install the certificate,
uncomment the block, redeploy with `--force`.

## Running under PM2

`ecosystem.config.cjs` defines both processes — the backend and the
queue worker — in all three modes:

```sh
pnpm pm2:start              # development
pnpm pm2:start:staging
pnpm pm2:start:production

pnpm pm2:status             # what is running
pnpm pm2:logs               # tail both processes
pnpm pm2:restart            # reload code
pnpm pm2:stop               # stop, keep them in the process list
pnpm pm2:delete             # remove from the process list
```

Switching environment requires a restart carrying the flag, because
PM2 remembers the environment a process was started with:
`pm2 restart ecosystem.config.cjs --env production`.

`.envs/` holds one file per mode and is **git-ignored** — those files
carry working credentials. What is committed is `.env.example`,
generated by `pnpm sync`, naming every variable any module declares:
a clone copies it into `.envs/.env.<mode>` and fills it in. Servers
usually skip the file entirely and inject variables through the
container environment, which always wins over it. `pnpm check`
validates the current environment without booting, so a deploy can
fail on configuration before it fails on traffic.

PM2 is a devDependency so the scripts work straight after install;
servers usually install it globally instead (`npm i -g pm2`), in
which case the same scripts still work.

Two defaults worth knowing: processes run in **fork** mode with a
single instance, because Socket.IO needs sticky sessions or the Redis
adapter before a second instance is safe; and `kill_timeout` is 10s so
graceful shutdown can drain queues and close mongo and redis before
PM2 sends SIGKILL.
