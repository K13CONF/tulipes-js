import config from "@config/app.config.js"
import { createLogger } from "@/config/logger.js"
import defineACL from "@/packages/acl/define-acl.js";
import type { ModuleConfig } from "@/types/module.js"

export const logger = createLogger({ module: "categories" })

export async function getModuleConfig() {
    return {
        name: "Core",
        description: "Core module",
        version: "1.0.0",

        priority: 0,
        depends: [],

        acl: defineACL({}).acl,
        routes: [],

        i18nFolderPath: "./i18n",
        viewsFolderPath: "./views",
        modelsFolderPath: "./models",

        onInit: async () => {
            
            const modules = config.app.modules
            const routes = modules.flatMap((module: ModuleConfig) => module.routes ?? [])


        },
    } satisfies ModuleConfig
}
