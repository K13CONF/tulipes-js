export { defineConfig, isConfigDeclaration, declarationJsonSchema, type ConfigDeclaration, type FieldMeta } from "./define-config.ts";
export { declareConfig } from "./declare-config.ts";
export {
  FileSettingsStore,
  MemorySettingsStore,
  SettingsConflictError,
  SYSTEM_ACTOR,
  type Actor,
  type SettingsStore,
  type StoredSettings,
} from "./settings-store.ts";
export {
  Settings,
  SettingsValidationError,
  type SettingsApi,
  type SettingsDescription,
  type SettingsWrite,
} from "./settings.ts";
import type { VariableValue } from "../env/spec.ts";

export type { EnvVariableDescription, VariableSource } from "../env/resolved.ts";
export type { VariableValue };

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
  /**
   * What core reads to listen. Set by `config/app.config.ts`, usually from
   * an environment value: `server: { port: env.core.port }`. `boot({ port })`
   * wins over it; without either the backend listens on 3000.
   */
  server?: { port?: number };
  [moduleName: string]: Record<string, unknown> | undefined;
}

/**
 * Every module's resolved environment values, `env.<module>.<name>` — what
 * `config/app.config.ts` receives. Also an augmentation target of
 * `tulipes sync`, which adds one property per module from its package.json
 * `tulipes.env`, so `env.core.port` is a `number` in the app config and
 * `ctx.config.core.port` is one everywhere else.
 */
export interface EnvValues {
  [moduleName: string]: Readonly<Record<string, VariableValue | undefined>> | undefined;
}
