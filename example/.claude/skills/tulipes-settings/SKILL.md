---
name: tulipes-settings
description: Use when working with the settings module — the sysadmin console that describes every module, edits environment variables and translations, restarts the app, or streams logs. Covers the sysadmin role, where a written variable actually lands, and why some writes cannot take effect.
---

# The settings module

An infrastructure console: what every module declares, what its variables
resolve to and from where, its translations, and a live view of the logs.

Everything it reports comes from the **booted context** — `ctx.modules`,
the variable store, the ACL, the RAI registry — so it cannot describe an
app different from the one running.

## Access is `sysadmin`, and that is a real boundary

`settings:*` is granted only to `sysadmin`. This works because the auth
module grants `admin` its namespaces **explicitly** rather than `*`:

```ts
acl.allow("admin",    "auth:*", "users:*", "hello:*");
acl.allow("sysadmin", "auth:*", "users:*", "hello:*");   // + settings:* from settings
```

**A wildcard would reach `settings:*` like any other id**, and "sysadmin
only" would be a label rather than a rule. When you add a feature module,
add its namespace to *both* grants — a new module is invisible to admin
otherwise.

A fresh app seeds an `admin`, so the console is inert until someone is
deliberately promoted to `sysadmin`.

## Endpoints

| | |
|---|---|
| `GET /settings/modules` | every module: manifest, variables with full spec + resolved source, config, i18n, routes |
| `GET /settings/variables/:name` | one variable; `?reveal=true` returns a secret's value, audited |
| `PUT /settings/variables/:name` | set a value — validated against the variable's own spec |
| `GET`/`PUT /settings/i18n/:module/:locale` | read or replace a module's translations |
| `POST /settings/reboot` | restart via PM2 so written values take effect |
| `GET /settings/logs/stream` | SSE; `?process=backend\|worker&level=warn&tail=200` |

## Where a written variable actually lands

**Always `.envs/.env.<APP_ENV>` — never `meta.variables.json`.** That file
is the module's committed contract: rewriting a default there would change
it for every environment and be lost on the next deploy. The env file is
what exists to hold per-deployment values.

The file is edited **surgically** — one line replaced, comments and
ordering untouched — because these files are half explanation and a
`stringify(parse(file))` round trip would erase all of it.

### The case that catches people

Precedence is `process.env` → env file → default. A variable injected by
the **container** outranks both, so writing the file changes nothing, and
a restart re-reads the same container environment and it wins again.

When that happens the write still lands in the file *and* sets
`process.env` live, and the response says so:

```jsonc
{ "meta": { "action": "restart_required_shadowed" } }
```

That makes the change real for **this process only**. Other replicas keep
the old value until the container's environment itself is changed.

## Nothing takes effect until a restart

Variables resolve once at boot, and `config.<module>` is derived from them
by factories that also run once. A write persists; it does not move the
running app. Every write response carries `requires_reboot: true`.

`POST /settings/reboot` restarts through PM2, ordering the process serving
the request **last** so the caller still gets its response. Under `yarn
dev` there is no PM2, and it answers `503 NOT_SUPERVISED` rather than
exiting a process nothing would restart.

## Logs are read from files, not hooked in-process

The stream tails `LOG_DIR`, which is what lets it show the **worker** —
backend and worker are separate processes writing separate files, and an
in-process stream could only ever show its own. The tailer is
rotation-aware: pino-roll renames and starts a new file, and a naive watch
on one path goes silent the moment it rolls.

`LOG_FILE=false` means there are no files; the endpoint says so rather
than streaming nothing.

## Audit

Every reveal, write and reboot logs at `warn` with actor, role, IP and
old→new. **A secret's value is never recorded in either direction** — an
audit entry that reconstructs a rotated key defeats rotating it; those
entries carry `redacted: true` and no values.

`?level=warn` on the log stream shows the audit trail and nothing else.

## Rules

- Never add a `settings:*` grant to another role. If someone needs part of
  it, give them `sysadmin`, or split the ids.
- Never widen a write to `meta.variables.json`. It is a contract, not
  storage.
- A new feature module needs its namespace in **both** the `admin` and
  `sysadmin` grants.
- Treat a `restart_required_shadowed` response as a warning to fix the
  deployment's environment, not as a successful change.
