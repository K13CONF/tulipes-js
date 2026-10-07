<div align="center">

<img src="https://cdn.jsdelivr.net/npm/@tulipes/core@0.7.1/assets/tulipesjs-logo.png" alt="TulipesJs" width="340">

</div>

# @tulipes/mongoose

The Mongoose **models provider** for [Tulipes](https://www.npmjs.com/package/@tulipes/core)
apps. It connects, compiles every module's `models/*.model.ts` on the boot's
own connection, runs `bootstrap/*.bootstrap.ts`, and closes the connection
under core's shutdown deadline. Core itself no longer installs or imports
Mongoose; an app without a database declares no provider and never pays for one.

Requires Node 24.x, `mongoose@^8` as the app's own dependency (peer — the app's
schemas and this provider must share one instance) and a core that ships the
provider contract.

## Select it

One line in the app's root `package.json`:

```jsonc
{ "tulipes": { "providers": { "models": "@tulipes/mongoose" } } }
```

and `MONGO_URI` declared by the app's sys `core` module (`meta.variables.json`)
and set. Modules with `models/` or `bootstrap/` directories require the
provider automatically; a module that only reads models declares
`"tulipes": { "requires": ["models"] }` in its own manifest. Boot refuses an
unmet requirement before any module code is imported. Installing this package
without the declaration selects nothing; a `MONGO_URI` on its own connects
nothing.

## Use it

```ts
// modules/users/models/user.model.ts
import { Schema } from "mongoose";
import type { ModelDef } from "@tulipes/mongoose";

const userSchema = new Schema({ email: { type: String, required: true } });
export default { name: "User", schema: userSchema } satisfies ModelDef;

// anywhere after phase 8
const User = requireModels(ctx).get<UserDoc>("User");   // typed once this package is in the compilation
ctx.models.connection;                                   // the boot's own mongoose Connection
```

`ModelDef`, `BootstrapFn` and `ModelStore` moved here from `@tulipes/core/db`;
`ctx.models`, `requireModels` and `DatabaseCtx` stay in `@tulipes/core/boot`.

## Behavior

- One connection per boot, `serverSelectionTimeoutMS: 5000`; ownership is
  registered with core before the connection is awaited, so a database that
  never answers is still closed by the failed-boot cleanup.
- Models register in module load order; a second module registering the same
  name is a boot error naming both. `def.schema` must be a `Schema` from the
  same `mongoose` instance.
- Bootstrap tasks run in backend and worker processes, never in `script` mode
  or runtime inspection, and only when registration reported nothing.
- Global plugins (`mongoose.plugin(...)`) remain application code and apply
  because the app and this provider share the instance.

## Versions

`0.1.0-rc.2` (no source change since rc.1; republished with core 0.10.0-rc.2)
requires core `^0.10.0-rc.1`, the candidate that introduced the provider seam;
install both with `@next`. See core's
[MIGRATING.md](https://github.com/kemora13conf/bp-backend-express/blob/v0.10.0-rc.1/packages/core/MIGRATING.md#0100-rc1--declare-the-models-provider).

## The settings store

The same package keeps an app's settings in MongoDB. Select it in the app's
root `package.json`:

```jsonc
{ "tulipes": { "providers": { "models": "@tulipes/mongoose", "settings": "@tulipes/mongoose/settings" } } }
```

Every namespace a `module.config.ts` declares is one document in the
`settings` collection — `{ _id: "<module>", values, version, updated_at,
updated_by }` — seeded with the schema's defaults on first boot. A write
through `ctx.settings.set()` is a `findOneAndUpdate` on `{ _id, version }`:
a stale version is refused with the current document, so two operators
cannot overwrite each other, and the document it replaced goes to
`settings_history`. Other processes see the change through a change stream
when the connection is to a replica set and by polling (every 2s) otherwise;
core validates every incoming document against the module's schema before
applying it. The store shares the models provider's connection when both
are this package, and opens its own from `MONGO_URI` when the app keeps no
mongoose models. Without the declaration core keeps settings in
`config/settings.<APP_ENV>.json`.
