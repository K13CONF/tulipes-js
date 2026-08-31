/**
 * What the core module offers the rest of the app.
 *
 * Other modules import these by package name — `@app/core` — never by a
 * relative path climbing out of their own folder. That is what keeps the
 * dependency visible: a module that uses this has to declare @app/core,
 * so the coupling shows up in its package.json instead of hiding in an
 * import string.
 */
export {
  appCache,
  closeCache,
  BaseCache,
  MemoryCache,
  RedisCache,
  type Cache,
} from "./helpers/cache/index.js";

export {
  baseSchemaOptions,
  baseModelPlugin,
  softDeletePlugin,
  timestampsPlugin,
  registerBasePlugins,
  type Actor,
  type BaseDocument,
  type SoftDeleteFields,
  type SoftDeleteMethods,
  type Timestamps,
} from "./helpers/mongoose/index.js";
