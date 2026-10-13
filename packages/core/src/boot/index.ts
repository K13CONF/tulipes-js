export { boot, processModes, type BootHandle, type BootOptions, type ProcessMode } from "./boot.ts";
export type { AppConfigFn, AppConfigMeta } from "./app-files.ts";
export { appEnvs, type AppEnv } from "./app-env.ts";
export type {
  Ctx,
  RuntimeCtx,
  BackendCtx,
  DatabaseCtx,
  BootstrapCleanup,
  BootstrapFn,
  ModelsCapability,
  ProviderCapabilities,
  QueuesCapability,
  SocketsCapability,
  RoutesFn,
} from "./contracts.ts";
export {
  PROVIDER_CONTRACT,
  readProviderDeclarations,
  type AcquiredResource,
  type Provider,
  type ProviderContext,
  type ProvidedValues,
  type ProviderDeclarations,
  type ProviderStatus,
} from "./providers.ts";

export { requireModels, requireQueues } from "./contracts.ts";
/** For providers: import one conventional file, funnelling failures into the report. */
export { importFile } from "./import-file.ts";
/**
 * For tooling (`tulipes sync`, `tulipes env:check`): phase 1 on its own.
 * An app reads a value as `ctx.config.<module>.<name>`, never through these.
 */
export { resolveAppEnv } from "./app-env.ts";
export {
  resolveEnv,
  ResolvedEnv,
  type EnvDeclaration,
  type ResolveEnvOptions,
  type ResolvedVariable,
  type VariableSpec,
  type VariableType,
} from "../env/index.ts";
