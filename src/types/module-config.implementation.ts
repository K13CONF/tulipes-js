/**
 * Module configuration contract.
 *
 * Every feature module under `src/modules/<name>/` exposes a `module.config.ts`
 * whose factory returns an object satisfying this shape. The global config
 * resolver (`@config/index.ts`) discovers each `module.config.{ts,js}` file via
 * glob and merges them under `app.modules[name]`.
 *
 * The generics let a module describe the precise shape of its own `config` and
 * `services`; both default to an open record so untyped modules still satisfy
 * the contract.
 */
export interface ModuleConfig<
    Config extends Record<string, unknown> = Record<string, unknown>,
    Services extends Record<string, unknown> = Record<string, unknown>,
> {
    /** Unique module name — used as its key under `app.modules`. */
    name: string

    /** Module-specific configuration values. */
    config: Config

    /** Module-specific services / providers exposed to the application. */
    services: Services
}

/**
 * Signature of the async factory a module exports to build its `ModuleConfig`.
 * This is the type a `module.config.ts` file's `getModuleConfig` implements.
 */
export type ModuleConfigFactory<
    Config extends Record<string, unknown> = Record<string, unknown>,
    Services extends Record<string, unknown> = Record<string, unknown>,
> = () => Promise<ModuleConfig<Config, Services>>
