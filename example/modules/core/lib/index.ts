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
} from "../helpers/cache/index.ts";

export { LOG_FILES, logger, moduleLogger } from "../helpers/logger/index.ts";

export { lazy } from "../helpers/lazy.ts";

export {
  CLIENT_HEADERS,
  clientHeaders,
  readClientHeaders,
  type ClientHeaders,
  type HeaderSpec,
} from "../helpers/client-headers.ts";

export {
  grammar,
  grammarFor,
  LIMITS,
  listQuery,
  operators,
  configureListQueries,
  listQueryDefaults,
  runQuery,
  toMongoose,
  type CompileOptions,
  type CompiledQuery,
  type ListQueryDefaults,
  type QueryResult,
  type Condition,
  type FieldType,
  type FilterRule,
  type ListQuery,
  type Operator,
  type ParsedListQuery,
  type QueryPolicy,
  type Resolve,
  type ResolvePolicy,
  type SortKey,
} from "../helpers/query/index.ts";

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
} from "../helpers/mongoose/index.ts";
