---
name: tulipes-model
description: Use when adding or changing a database model in a Tulipes app, querying from a route or job, seeding data, or ensuring indexes. Covers the ModelDef contract, the model store and bootstrap tasks.
---

# Adding a model

Model files are **declarations**, not registrations. Never call
`mongoose.model()` — the framework compiles the schema on its own
connection and puts it in the model store.

`modules/billing/models/invoice.model.ts`:

```ts
import { Schema } from "mongoose";
import type { ModelDef } from "@tulipes/mongoose";
import { baseSchemaOptions } from "@app/core";

const invoiceSchema = new Schema(
  {
    customer: { type: Schema.Types.ObjectId, ref: "User", required: true },
    amount_cents: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["draft", "paid"], default: "draft", index: true },
  },
  baseSchemaOptions,
);

export default { name: "Invoice", schema: invoiceSchema } satisfies ModelDef;
```

## Field names are snake_case

Every persisted field — and therefore every field that reaches a response
body — is `snake_case`: `amount_cents`, `created_at`, `last_seen_at`,
`password_hash`. camelCase is for TypeScript-only names: locals, function
parameters, helper return shapes that never reach mongo or the wire.

**Never declare `createdAt` / `updatedAt` yourself.** `baseSchemaOptions`
already provides them as `created_at` and `updated_at`, and a hand-declared
camelCase field silently shadows the plugin, leaving you with both.

Renaming a persisted field is a data migration, not a rename: existing
documents keep the old key and stop matching queries. Write a bootstrap
task with `$rename` when you change one on live data.

Read it anywhere the context reaches:

```ts
const Invoice = models!.get("Invoice");
```

`models.get()` throws on an unregistered name (listing what does exist),
so a typo fails at the call site instead of returning `undefined`.

## Requirements

- The app selects its database once, in its root `package.json`:
  `"tulipes": { "providers": { "models": "@tulipes/mongoose" } }`. A module
  with `models/` or `bootstrap/` files in an app without that line is a boot
  refusal before any model is imported. A module that reads models but owns
  none declares `"tulipes": { "requires": ["models"] }` in its own manifest.
- The provider needs `MONGO_URI` declared (sys `core` module) and set;
  selected without a value is a boot refusal, not a warning.
- Model names are globally unique; two modules registering `Invoice`
  crashes the boot naming both.
- Reference other modules' models by name (`ref: "User"`) — no import,
  therefore no coupling.

## Seeding and indexes

Put anything that must run after models exist but before the server
accepts traffic in `modules/<name>/bootstrap/*.bootstrap.ts`:

```ts
import type { Ctx } from "@tulipes/core/boot";

export default async function seedPlans({ models }: Ctx): Promise<void> {
  const Plan = models!.get("Plan");
  await Plan.updateOne(
    { code: "free" },
    { $setOnInsert: { code: "free", price_cents: 0 } },
    { upsert: true },
  );
}
```

**Make bootstrap tasks idempotent** — they run on every boot, in every
process, including each worker. Upsert; never blind-insert.

**And tolerate concurrency.** Backend and worker start together, so two
processes run the same seed at the same time. Concurrent upserts on a
unique index race: one inserts, the other gets a duplicate-key error
(`code: 11000`). Catch that one code and carry on — the row exists, which
is all the task wanted.

## Gotchas

- Global plugins (timestamps, soft delete) only apply to schemas compiled
  *after* registration, which is why `registerBasePlugins()` is called from
  the sys core module's `module.config.ts` — declaration time (phase 4),
  before models compile in phase 5. That covers every mode, scripts included; calling it from
  `app.ts` instead would leave scripts compiling models without the
  soft-delete guard.
- Mongoose queries are lazy: `await` them, and prefer `.lean()` for reads
  you only serialize.
- If the app soft-deletes, ordinary queries already exclude deleted rows;
  use `.withDeleted()` / `.onlyDeleted()` to opt out deliberately.
