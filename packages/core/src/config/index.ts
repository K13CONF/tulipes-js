export { buildGlobalConfig } from "./build-config.js";

/**
 * The global config: one plain object, namespaced by module short-name —
 * whatever `modules/users/module.config.ts` returns lives at `config.users`.
 *
 * Augmentation target for the generated `types/config.d.ts` (`forgex sync`):
 * codegen adds one property per module, typed as its factory's return type.
 * Declared in THIS module (not re-exported) because TypeScript module
 * augmentation only merges with the module that declares the interface.
 */
export interface GlobalConfig {
  [moduleName: string]: Record<string, unknown> | undefined;
}
