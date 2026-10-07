export { defineConfig, isConfigDeclaration, declarationJsonSchema, type ConfigDeclaration, type FieldMeta } from "./define-config.js";
export { declareConfig } from "./declare-config.js";
export {
  FileSettingsStore,
  MemorySettingsStore,
  SettingsConflictError,
  SYSTEM_ACTOR,
  type Actor,
  type SettingsStore,
  type StoredSettings,
} from "./settings-store.js";
export {
  Settings,
  SettingsValidationError,
  type SettingsApi,
  type SettingsDescription,
  type SettingsWrite,
} from "./settings.js";

/**
 * The global config: one plain object, namespaced by module short-name —
 * the settings `modules/users/module.config.ts` declares live at `config.users`,
 * kept live by the settings manager.
 *
 * Augmentation target for the generated `types/tulipes.d.ts` (`tulipes sync`):
 * codegen adds one property per module, typed as its schema's output.
 * Declared in THIS module (not re-exported) because TypeScript module
 * augmentation only merges with the module that declares the interface.
 */
export interface GlobalConfig {
  [moduleName: string]: Record<string, unknown> | undefined;
}
