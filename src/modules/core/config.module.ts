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

        onInit: async () => { },
    } satisfies ModuleConfig
}
