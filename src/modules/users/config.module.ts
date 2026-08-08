import mongoose from 'mongoose';
import { createLogger } from '@/config/logger.js';
import env from '@config/env.js';
import { acl } from './acl.module.js'
import { boRoutes } from './routes/bo.routes.js'
import type { ModuleConfig } from '@/types/module.js'
import type { IUser } from './models/user.model.js'

// Instanciate a dedicated logger for this module
export const logger = createLogger({ module: "users" })

export async function getModuleConfig() {

    return {
        name: 'users',
        description: 'Users module configuration',
        version: '1.0.0',

        // Init order: higher priority runs first; `depends` init before this one.
        priority: 1,
        depends: [],

        // Module specific configurations can be added here, for example:
        acl: acl,

        // Routes collected for this module, mounted by the HTTP layer.
        routes: boRoutes,

        // Module folder paths
        i18nFolderPath: "./i18n",
        modelsFolderPath: "./models",

        // Lifecycle hook, run during bootstrap in dependency + priority order.
        onInit: async () => {
            // One-off boot task — same gating as core's resource sync: only
            // cluster instance 0 (or a single/fork process) runs the seed.
            const instance = process.env.NODE_APP_INSTANCE
            if (instance && instance !== "0") return

            // Sysadmin seed: opt-in via env (both-or-neither, enforced by env.ts).
            const { SEED_SYSADMIN_EMAIL: email, SEED_SYSADMIN_PASSWORD: password } = env
            if (!email || !password) return

            // Idempotent: never recreate, never overwrite a rotated password.
            const UserModel = mongoose.model<IUser>("User")
            const exists = await UserModel.exists({ email })
            if (exists) return

            // create() runs the save path, so the Authenticable pre-save hook
            // hashes the password — an upsert would store it in plaintext.
            await UserModel.create({ email, password, roles: ["sysadmin"] })
            logger.info(`Seeded sysadmin account "${email}"`)
        },
    } satisfies ModuleConfig;
}
