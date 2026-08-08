import { createLogger } from '@/config/logger.js';
import { acl } from './acl.module.js'
import { publicRoutes } from './routes/public.routes.js'
import { configurePassport } from './helpers/passport.js'
import type { ModuleConfig } from '@/types/module.js'

// Instanciate a dedicated logger for this module
export const logger = createLogger({ module: "auth" })

export async function getModuleConfig() {

    return {
        name: 'auth',
        description: 'Authentication — login, token refresh, logout, registration',
        version: '1.0.0',

        // Init order: higher priority runs first; `depends` init before this one.
        priority: 2,
        depends: [],

        acl: acl,
        routes: publicRoutes,

        // Module folder paths. No modelsFolderPath — auth owns no models; it
        // authenticates the models other modules register via `Authenticable`.
        i18nFolderPath: "./i18n",

        // Lifecycle hook, run during bootstrap in dependency + priority order.
        onInit: async () => {
            // Models load before modules init (see lib/bootstrap.ts), so every
            // Authenticable.register(...) has already run when the strategy binds.
            configurePassport()
            logger.info("Passport local strategy configured")
        },
    } satisfies ModuleConfig;
}
