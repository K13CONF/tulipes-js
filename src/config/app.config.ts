import env from '@config/env.js'
import roles from '@config/roles.definition.js'
import { moduleACLSchema } from '@packages/acl/schema.js'

// import all the modules configs here
import * as core from '@/modules/core/config.module.js'
import * as users from '@/modules/users/config.module.js'
import * as categories from '@/modules/categories/config.module.js'

const modules = {
    core: await core.getModuleConfig(),
    users: await users.getModuleConfig(),
    categories: await categories.getModuleConfig(),
}

export type Modules = typeof modules;


function resolveModulesACLs(modules: Modules): Map<string, string[]> {
    // role name -> set of granted permissions (deduped across modules)
    const merged = new Map<string, Set<string>>();

    // retrieve all the modules acls and merge them by roles
    for (const [moduleName, module] of Object.entries(modules)) {
        // validate the module's ACL shape before merging it
        const result = moduleACLSchema.safeParse(module.acl);
        if (!result.success) {
            console.error(`❌ Invalid ACL in module "${moduleName}":`);
            result.error.issues.forEach(issue => {
                console.error(`❌ ${issue.path.join('.')} ${issue.message}`);
            });
            process.exit(1);
        }

        for (const [role, permissions] of Object.entries(result.data)) {
            const granted = merged.get(role) ?? new Set<string>();
            permissions.forEach(permission => granted.add(permission));
            merged.set(role, granted);
        }
    }

    // freeze the per-role permission sets into arrays for consumption
    return new Map(
        Array.from(merged, ([role, permissions]) => [role, Array.from(permissions)])
    );
}

/**
 * @function resolveGlobalConfig
 * @description This function resolves the global configuration for the application.
 * It merges the environment variables and any module-specific configurations into a single configuration object.
 */
export default await (async function resolveGlobalConfig() {

    const ACL = resolveModulesACLs(modules)

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

            roles: roles,
            acl: ACL,

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
                    host: env.HOST,
                    https: {
                        isEnabled: env.HTTPS_ENABLED === "true",
                    },
                    clusterModeEnabled: env.CLUSTER_MODE_ENABLED === "true",
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
                    algorithm: env.JWT_ALGORITHM,
                    privateKey: env.JWT_PRIVATE_KEY,
                    publicKey: env.JWT_PUBLIC_KEY,
                    expiresIn: env.JWT_EXPIRES_IN,
                    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
                },

                mailer: {
                    from: env.MAILER_FROM,
                    host: env.MAILER_HOST,
                    port: parseInt(env.MAILER_PORT, 10),
                    user: env.MAILER_AUTH_USER,
                    password: env.MAILER_AUTH_PASS,
                },

                i18n: {
                    fallbackLanguage: env.I18N_FALLBACK_LANGUAGE,
                    supportedLanguages: env.I18N_SUPPORTED_LANGUAGES.split(",").map((l) => l.trim()).filter(Boolean),
                    defaultNamespace: env.I18N_DEFAULT_NAMESPACE,
                }
            },

            // Here we have configurations dedicated for any modules that we have in our application.
            modules: modules,
        }
    }
})();