---
name: tulipes-config
description: Use when adding or changing a setting — a value an operator should be able to edit at runtime — or when working on the config module, the console that describes every module and edits settings. Covers defineConfig, onChange, restart-tagged fields, the console endpoints, versions and the audit.
---

# Settings and the config module

A setting is declared once, in the module's `module.config.ts`, the file's
only export:

```ts
import { defineConfig } from "@tulipes/core/config";
import { z } from "zod/v4";

export default defineConfig({
  schema: z.object({
    maxSessions: z.number().int().positive().default(5)
      .describe("Max concurrent sessions per user; the oldest is evicted past it"),
    signupMode: z.enum(["open", "invite", "closed"]).default("open")
      .describe("Who can register"),
    listenPort: z.number().int().default(8080).meta({ restart: true })
      .describe("Applied on the next boot"),
  }),
  /** Optional: rebuild what was built from a value. Runs in every replica after a write lands. */
  onChange(next, ctx) {
    rebuildRateLimits(ctx, next.rateLimits);
  },
});
```

`pnpm sync` types it: `ctx.config.users.maxSessions` is a `number` at
every call site. Read it where it is used, never capture it at boot — the
object is replaced in place when a write lands.

## Rules

- **Every field has a default.** A namespace never written is its
  defaults; the first boot writes them. There is no "required setting",
  because an operator cannot be asked for a value the process needs to boot.
- **No secrets.** `defineConfig` refuses a field whose metadata says
  `secret`; a secret is an environment value, declared in the module's
  package.json and read beside the settings at `ctx.config.<module>`, never
  listed. → skill `tulipes-env-variable`
- **Describe every field.** `.describe()` is what the console form, the
  generated types and an agent reading the manifest see.
- **Validate in the schema, not in `onChange`.** The store persists before
  `onChange` runs, so a refinement that throws there would leave a value
  stored that the module cannot use. `.refine()` keeps it out of the store.
- **Rebuild in `onChange` what you built from a value.** A middleware
  constructed from a setting at boot does not see the write; either build
  it per request from the live value (helmet, CORS, the body parser do) or
  rebuild it in `onChange` (the rate limiter does, because it holds a Redis
  client).
- **Tag what cannot be hot-applied** with `.meta({ restart: true })`. The
  write persists, applies on the next boot, and the response carries
  `requires_restart` and `meta.action: "restart_required"`.

## The console: the `config` module

| | |
|---|---|
| `GET /config` | every module in load order: manifest, environment values (config name, variable, type, source — a secret's value never), settings with schema, live values and stored version, endpoints with the roles that reach them |
| `GET /config/:module` | the same for one module |
| `PATCH /config/:module` | `{ values: { … }, version? }` — a patch over the stored values, validated by the module's schema (422 with the field), refused when `version` is not the stored one (409 `STALE_VERSION`), audited before it lands, applied at once in every replica |

`config:bo:read` and `config:bo:describe` are granted to `admin` and `sysadmin`;
`config:bo:write` to `sysadmin` only. The audit (`config_audit_events`) holds
the namespace, the field names, the version the caller read, the actor and
the client IP — never a value — and is acknowledged by a majority before
the write happens: a change nobody can account for is worse than one that
did not happen. Variables are read-only here: what boot needs before the
store answers, and secrets, are not edited at runtime.

The same three endpoints are tools in the agent manifest, so an agent with
`sysadmin` reconfigures the app through the door an operator uses, with
the same audit. → skill `tulipes-agent-tool`
