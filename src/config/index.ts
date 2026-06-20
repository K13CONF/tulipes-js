import env from '@config/env.js'
import path from 'path'
import { glob } from 'glob'
import type { ModuleConfig } from '@/types/module-config.implementation.js';

// Path to the modules configuration files
const modulesConfigs = glob.sync(path.resolve(__dirname, '../ modules/*/module.config.{ts,js}'), { absolute: true, ignore: ['**/node_modules/**'] })

/**
 * @function resolveGlobalConfig
 * @description This function resolves the global configuration for the application.
 * It merges the environment variables and any module-specific configurations into a single configuration object.
 */
const resolveModulesConfigs = async () => {
    const modules = {} as Record<string, ModuleConfig>
    for (const configPath of modulesConfigs) {
        const { getModuleConfig } = await import(configPath)
        const { name, config: moduleConfig, services } = await getModuleConfig()
        if (modules[name]) {
            console.warn(`⚠️ Duplicate module name "${name}" found in ${configPath}. This will overwrite the previous module with the same name.`)
        }
        modules[name] = {
            config: moduleConfig,
            services
        }
    }

    return modules
}

/**
 * @function resolveGlobalConfig
 * @description This function resolves the global configuration for the application.
 * It merges the environment variables and any module-specific configurations into a single configuration object.
 */
export default await (async function resolveGlobalConfig() {

    return {
        app: {
            // Runtime environment
            env: env.NODE_ENV,
            isDevelopment: env.NODE_ENV === 'development',
            isProduction: env.NODE_ENV === 'production',

            // Application general informations
            title: "Express Boilerplate",
            description: "A boilerplate for building REST APIs with Express.js and TypeScript",
            version: '1.0.0',



            // API configuration
            api: {
                prefix: '/api',
                version: 'v1'
            },

            // Any library configuration can be added here, for example:
            // Database, JWT, Mailer, etc.
            lib: {
                server: {
                    port: parseInt(env.PORT, 10),
                    host: env.HOST
                },

                database: {
                    protocol: env.DATABASE_PROTOCOL,
                    host: env.DATABASE_HOST,
                    port: parseInt(env.DATABASE_PORT, 10),
                    name: env.DATABASE_NAME,
                    user: env.DATABASE_USER,
                    password: env.DATABASE_PASSWORD
                },

                jwt: {
                    secret: env.JWT_SECRET,
                    expiresIn: env.JWT_EXPIRES_IN
                },

                mailer: {
                    from: env.MAILER_FROM,
                    host: env.MAILER_HOST,
                    port: parseInt(env.MAILER_PORT, 10),
                    user: env.MAILER_AUTH_USER,
                    password: env.MAILER_AUTH_PASS,
                }
            },

            // Here we have configurations dedicated for any modules that we have in our application.
            modules: {

            }
        }
    }
})();