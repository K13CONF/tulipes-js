import { createLogger } from "@/config/logger.js"
import { acl } from "./acl.module.js"
import { boRoutes } from "./routes/bo.routes.js"
import { publicRoutes } from "./routes/public.routes.js"
import type { ModuleConfig } from "@/types/module.js"

export const logger = createLogger({ module: "categories" })

export async function getModuleConfig() {
    return {
        name: "categories",
        description: "Categories module",
        version: "1.0.0",

        priority: 3,
        depends: [],

        acl: acl,
        routes: [...boRoutes, ...publicRoutes],

        i18nFolderPath: "./i18n",
        modelsFolderPath: "./models",

        onInit: async () => {},
    } satisfies ModuleConfig
}
