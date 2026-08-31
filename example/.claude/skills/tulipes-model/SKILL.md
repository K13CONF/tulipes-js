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
import type { ModelDef } from "@tulipes/core/db";

const invoiceSchema = new Schema({
  customer: { type: Schema.Types.ObjectId, ref: "User", required: true },
  amountCents: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ["draft", "paid"], default: "draft", index: true },
});

export default { name: "Invoice", schema: invoiceSchema } satisfies ModelDef;
```

Read it anywhere the context reaches:

```ts
const Invoice = models!.get("Invoice");
```

`models.get()` throws on an unregistered name (listing what does exist),
so a typo fails at the call site instead of returning `undefined`.

## Requirements

- The database needs `MONGO_URI` declared (sys `core` module) and set. A
  module that ships models without it is a boot refusal, not a warning.
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
    { $setOnInsert: { code: "free", priceCents: 0 } },
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
  the sys core module's `module.config.ts` — phase 6, before models compile
  in phase 8. That covers every mode, scripts included; calling it from
  `app.ts` instead would leave scripts compiling models without the
  soft-delete guard.
- Mongoose queries are lazy: `await` them, and prefer `.lean()` for reads
  you only serialize.
- If the app soft-deletes, ordinary queries already exclude deleted rows;
  use `.withDeleted()` / `.onlyDeleted()` to opt out deliberately.
