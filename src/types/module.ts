import type { ACL } from "@packages/acl/types.js"
import type { RouteRecord } from "@packages/acl/define-routes.js"

/**
 * Contract every feature module's `getModuleConfig()` must satisfy.
 */
export interface ModuleConfig {
    /** Unique module name — used as the registry key and by `depends`. */
    name: string
    description: string
    version: string

    /** Access-control list: roles -> granted RAIs. */
    acl: ACL
    /** Routes collected for this module, mounted by the HTTP layer. */
    routes: RouteRecord[]

    /** Relative path to the folder that will contain i18n files for that module */
    i18nFolderPath?: string,
    /** Relative path to the folder that will contain models files  for that module */
    modelsFolderPath?: string


    /**
     * Tie-breaker for the init order among modules with no dependency relation.
     * Higher runs first. Defaults to 0.
     */
    priority?: number

    /** Names of modules that must be initialized before this one. */
    depends?: string[]

    /**
     * Lifecycle hook run once during bootstrap — after this module's `depends`
     * have initialized (and after the DB connection is established).
     */
    onInit?: () => void | Promise<void>

}
