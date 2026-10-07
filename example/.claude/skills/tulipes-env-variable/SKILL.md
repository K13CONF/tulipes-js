---
name: tulipes-env-variable
description: Use when adding or changing any configuration value in a Tulipes app — API keys, connection strings, feature toggles, limits — or when tempted to read process.env. Covers meta.variables.json, the resolution precedence and typed reads.
---

# Adding a configuration value

**Never read `process.env` directly.** Every value is declared by exactly
one module and read through the typed store. An undeclared read throws, so
a typo can never reach production as `undefined`.

## Steps

1. Choose the owning module. Infra shared by everything (`PORT`,
   `MONGO_URI`, `REDIS_URL`) belongs to the sys `core` module; anything
   feature-specific belongs to that feature's module.
2. Declare it in that module's `meta.variables.json`:

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

3. Add a value to `.envs/.env.development` for anything `required`.
4. `pnpm sync` — regenerates `types/config.d.ts` (so the read is typed)
   and `.env.example` (so deployments know what to set).
5. Read it: `Environment.get("BILLING_TRIAL_DAYS")` → typed `number`.

## Field rules

| Field | Rule |
|---|---|
| `name` | UPPER_SNAKE, and **globally unique** — two modules declaring the same name crash the boot. Do not re-declare a variable another module owns; just read it. |
| `type` | `string` · `number` · `boolean` · `enum` · `url` · `secret`. Values are coerced (`"14"` → `14`) and validated. |
| `enum` | Required with `type: "enum"`. Generates a literal union type. |
| `required` | No value anywhere → boot crash. Mutually exclusive with `default`. |
| `default` | Used when nothing supplies a value. Never put a real credential here. |
| `group` | Free-form label; groups the variable in the generated `.env.example`. |

Use `secret` for anything sensitive — those values are redacted in logs,
reports and the startup banner.

## Precedence

`process.env` › `.envs/.env.<APP_ENV>` › `default`. Container-injected
values always win, which is why deployments need no file.

## Where it does NOT go

- Value shared by several modules but the same everywhere (pagination
  limits, body size) → `config/app.config.ts`, not a variable.
- Value used by one module and never changed per deployment → that
  module's `module.config.ts`.

## Gotchas

- `Environment.get()` on an undeclared name **throws**. If you added the
  entry and still get the error, you did not run `pnpm sync`, or you
  edited a different module's meta file than the one you are reading from.
- `APP_ENV` (not `NODE_ENV`) selects the env file.
- A missing `required` variable is not a runtime surprise — the boot
  aborts and lists every missing variable at once.
