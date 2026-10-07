---
name: tulipes-settings
description: Use when streaming an app's logs, or when deciding whether a value is a setting or an environment variable and where it lives. Covers the settings module (the log stream), the two stores, and why the old console endpoints are gone.
---

# Settings and the settings module

Two layers of configuration. **Environment** is what the process needs
before the settings store can answer — the port, the connection strings,
the log destinations — plus secrets: declared under `tulipes.env` in a
module's `package.json`, read with `ctx.Environment.get()`, resolved once
at boot. **Settings** are everything else: declared with a zod schema in
`module.config.ts`, stored per module, validated on every write,
hot-applied, read live at `ctx.config.<module>`. The test is mechanical:
if boot does not need it before the database answers and it is not a
secret, it is a setting. → skills `tulipes-env-variable`, `tulipes-config`

## Where settings live

The app's root `package.json` selects the store. With
`"providers": { "settings": "@tulipes/mongoose/settings" }` (the production
preset) every namespace is one document in the `settings` collection —
`{ _id: "<module>", values, version, updated_at, updated_by }` — a write is
refused when its version is stale, the replaced document goes to
`settings_history`, and other processes pick the change up through a change
stream on a replica set or by polling otherwise. Without the declaration
(the minimal preset) the store is `config/settings.<APP_ENV>.json`, watched
for edits. Neither store validates: the module's schema does, in every
process, before a value is applied — an invalid document is logged and
ignored, never applied. `pnpm tulipes config:check` prints what the store
holds; the `config` module serves and edits it over HTTP.

## The settings module: the log stream

What is left of the old console is the one thing it did that the store
cannot: a live view of the logs.

| | |
|---|---|
| `GET /settings/logs/stream` | SSE; `?process=backend\|worker&level=warn&tail=200` |

It is `sysadmin`-only (`settings:*` is granted to that role alone, and the
auth module never grants `admin` the `*` wildcard, which is what makes the
boundary real). A stream outlives the request that opened it, so the
authority behind it is re-checked while it is open — against the database,
never the auth cache — and the stream ends on logout, password change,
session end, role change or deletion, on `ctx.signal` at shutdown, and
after a bounded duration and byte count. It reads the files the sys core
module's logger writes (`LOG_DIR`, names from `LOG_FILES` in `@app/core`)
and refuses when `LOG_FILE` is off.

## What is gone, and where it went

| 0.10 endpoint | 0.11 |
|---|---|
| `GET /settings/modules` | `GET /config` — the `config` module |
| `GET`/`PUT /settings/variables/:name` | gone: no editable secrets; variables are read-only in `GET /config` |
| `POST /settings/reboot` | gone: nothing needs a restart to take effect; a restart-tagged field says so in the write's response |
| `GET`/`PUT /settings/i18n/:module/:locale` | gone: translations are code, edited in the repository |
| the `.env` file editor, PM2 control, the audit of those | gone with them; the console's writes are audited by the `config` module |
