import { getModuleACL } from './module.acl.js'


export async function getModuleConfig() {
    const acl = await getModuleACL()

    return {
        name: 'users',
        description: 'Users module configuration',
        version: '1.0.0',

        // Module specific configurations can be added here, for example:
        acl: acl,
    };
}