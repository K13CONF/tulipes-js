---
name: tulipes-env-variable
description: Use when adding or changing any configuration value in a Tulipes app — API keys, connection strings, feature toggles, limits — or when tempted to read process.env. Covers the split between environment values (tulipes.env in package.json, read at ctx.config.<module>.<name>) and settings (the module.config.ts schema), the resolution precedence and what the console may show.
---

# Adding a configuration value

**First decide which of two things it is.** An *environment value* is what
the process needs before the database answers — a connection string, the
port, where logs go — or a secret. Everything else is a *setting*: declared
with a default in the module's `module.config.ts` schema, stored in the
settings store, editable by an operator at runtime without a restart:

```ts
// modules/billing/module.config.ts — the file's only export
import { defineConfig } from "@tulipes/core/config";
import { z } from "zod/v4";

export default defineConfig({
  schema: z.object({
    trialDays: z.number().int().positive().default(14).describe("Free trial length"),
    // a field the process cannot apply without a restart:
    workers: z.number().int().positive().default(2).meta({ restart: true }),
  }),
});
```

Every field needs a default, secrets are refused, and `pnpm sync` types
`ctx.config.billing.trialDays` as `number`. The rest of this guide is the
environment value.

**Both land in the same place.** A module's settings and its environment
values share its namespace, `ctx.config.<module>`: `config.billing.trialDays`
is a setting an operator edits, `config.billing.stripeApiKey` is an
environment value the deployment sets. Code reads them the same way; the
console (`GET /config`) shows the first with its value and the second by
name, type and source only. **Never read `process.env` directly.**

## Steps

1. Choose the owning module. Infra shared by everything (`PORT`,
   `MONGO_URI`, `REDIS_URL`) belongs to the sys `core` module; anything
   feature-specific belongs to that feature's module.
2. Declare it under `tulipes.env` in that module's `package.json`, keyed by
   the **config name** you will read it as, with `key` naming the variable
   the deployment sets:

```json
{
  "name": "@app/billing",
  "tulipes": {
    "env": {
      "stripeApiKey": {
        "key": "STRIPE_API_KEY",
        "type": "secret",
        "group": "billing",
        "required": true,
        "description": "Server-side Stripe key"
      },
      "webhookTolerance": {
        "key": "BILLING_WEBHOOK_TOLERANCE",
        "type": "number",
        "group": "billing",
        "description": "Seconds a webhook signature may be old",
        "default": 300
      }
    }
  }
}
```

3. Add a value to `.envs/.env.development` for anything `required`.
4. `pnpm sync` — regenerates `types/tulipes.d.ts` (so the read is typed)
   and `.env.example` (so deployments know what to set).
5. Read it where it is used: `ctx.config.billing.stripeApiKey`, typed
   `string`; a value with no default and not `required` is typed
   `| undefined`.

The framework and the providers read fixed keys that `config/app.config.ts`
wires from these values — `server.port`, `mongoose.uri`, `bullmq.redisUrl`.
A module's own values need no wiring.

## Field rules

| Field | Rule |
|---|---|
| name (the object key) | camelCase, like a settings field. Unique within the module, and not also a settings field — the boot refuses a name used by both. |
| `key` | UPPER_SNAKE, and **unique across the app** — two modules declaring the same key crash the boot. Do not re-declare a variable another module owns; read that module's config. |
| `type` | `string` · `number` · `boolean` · `enum` · `url` · `secret`. Values are coerced (`"14"` → `14`) and validated. |
| `enum` | Required with `type: "enum"`. Generates a literal union type. |
| `required` | No value anywhere → boot crash. Mutually exclusive with `default`. |
| `default` | Used when nothing supplies a value. Never put a real credential here. |
| `group` | Free-form label; groups the variable in the generated `.env.example`. |

Use `secret` for anything sensitive: its value is withheld from `GET
/config`, from `tulipes env:check` and from the startup banner.
A `url` value is shown with its credentials masked (`mongodb://•••@host/db`),
so a connection string can stay a `url`.

## How the values behave

- **Read-only.** Assigning to `ctx.config.billing.stripeApiKey` throws. A
  deployment value is not something code changes.
- **Invisible to listings.** `{ ...ctx.config.billing }`, `JSON.stringify`,
  `Object.keys` and `console.log` skip environment values — that is what
  keeps a secret out of a response body, a log line and the settings
  store. To see them, run `pnpm check` (`tulipes env:check`).
- **Refused under inspection.** `tulipes routes` and `tulipes spec` boot
  with nothing acquired; reading an environment value while *building* a
  router throws, naming it. Read it inside the handler, or build the
  middleware with `lazy()` from `@app/core`.

## Precedence

`process.env` › `.envs/.env.<APP_ENV>` › `default`. Container-injected
values always win, which is why deployments need no file.

## Where it does NOT go

- Value shared by several modules but the same everywhere (pagination
  limits, locales) → `config/app.config.ts`, not a variable.
- Any value an operator may want to change at runtime → a setting in that
  module's `module.config.ts` schema (above), not a variable.

## Gotchas

- A read is `undefined` and you expected a value: you did not run
  `pnpm sync` (the type would have told you), or the name is spelled
  differently from the manifest, or the value is optional and nothing
  supplied it.
- `APP_ENV` (not `NODE_ENV`) selects the env file; read it as `ctx.appEnv`.
- A missing `required` variable is not a runtime surprise — the boot
  aborts and lists every missing variable at once.
