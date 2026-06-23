import { createLogger } from '@/config/logger.js';
import { acl } from './acl.module.js'
import { boRoutes } from './routes/bo.routes.js'
import type { ModuleConfig } from '@/types/module.js'

// Instanciate a dedicated logger for this module
export const logger = createLogger({module: "users"})

export async function getModuleConfig() {

    return {
        name: 'users',
        description: 'Users module configuration',
        version: '1.0.0',

        // Init order: higher priority runs first; `depends` init before this one.
        priority: 0,
        depends: [],

        // Module specific configurations can be added here, for example:
        acl: acl,

        // Routes collected for this module, mounted by the HTTP layer.
        routes: boRoutes,

        // Module folder paths
        i18nFolderPath: "./i18",
        viewsFolderPath: "./views",
        modelsFolderPath: "./models",

        // Lifecycle hook, run during bootstrap in dependency + priority order.
        onInit: async () => {
            throw new Error("Testing")
        },
    } satisfies ModuleConfig;
}
