export { Environment, appEnvs, type AppEnv, type EnvironmentOptions } from "./environment.js";

/**
 * Augmentation target for the generated `types/config.d.ts` (`tulipes sync`):
 * one property per declared variable, typed from its meta spec. Empty here on
 * purpose — an app without codegen still gets `VariableValue` from get().
 *
 * Declared in THIS module (not re-exported) because TypeScript module
 * augmentation only merges with the module that declares the interface.
 */
export interface KnownVariables {}
export { VariableStore } from "./variable-store.js";
export { discoverModuleMeta, META_FILENAME, type ModuleMeta } from "./meta-discovery.js";
export {
  metaFileSchema,
  variableSpecSchema,
  variableTypes,
  type MetaFile,
  type VariableSpec,
  type VariableType,
  type VariableValue,
} from "./spec.js";
