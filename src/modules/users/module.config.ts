import type { ModuleConfig } from '@/types/module-config.implementation.js'

export async function getModuleConfig(): Promise<ModuleConfig> {

    return {
        name: 'users',
        config: {
            // Module specific configuration can be added here
        },
        services: {
            // Module specific services can be added here
        }
    };
}