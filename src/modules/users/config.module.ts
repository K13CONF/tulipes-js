import { getModuleACL } from './acl.module.js'
import { boRoutes } from './routes/bo.routes.js'


export async function getModuleConfig() {
    const acl = await getModuleACL()

    return {
        name: 'users',
        description: 'Users module configuration',
        version: '1.0.0',

        // Module specific configurations can be added here, for example:
        acl: acl,

        // Routes collected for this module, mounted by the HTTP layer.
        routes: boRoutes,
    };
}
