import config from "@config/app.config.js"
import { createLogger } from "@/config/logger.js"
import defineACL from "@/packages/acl/define-acl.js";
import type { ModuleConfig } from "@/types/module.js"
import mongoose from "mongoose"
import type { IResource } from "./models/resource.model.js";

export const logger = createLogger({ module: "core" })

export async function getModuleConfig() {
    return {
        name: "core",
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
            // Resource sync is a one-off boot task. Under PM2 cluster every
            // instance runs onInit, so only instance 0 (or a single/fork process,
            // where NODE_APP_INSTANCE is unset) performs the upsert — the others
            // would just repeat the same idempotent writes.
            const instance = process.env.NODE_APP_INSTANCE
            if (instance && instance !== "0") return

            const Resource = mongoose.model<IResource>("Resource")

            // 1. Get all the resources
            const modules = config.app.modules
            const routes = modules.flatMap((module: ModuleConfig) => module.routes ?? [])

            // 2. Now we need to create them to the database if they don't exist yet
            // and update the method, path and is_root of the existing ones if they have changed
            // this operation should be optimized to avoid unnecessary writes to the database
            // so we will be using bulkWrite operation to perform the upsert operation in a single query
            const bulkOps = routes.map((route) => ({
                updateOne: {
                    filter: { _id: route.rai },
                    update: {
                        $set: {
                            method: route.method,
                            path: route.path,
                            is_root: route.root || false,
                        },
                    },
                    upsert: true,
                },
            }))

            if (bulkOps.length > 0) {
                await Resource.bulkWrite(bulkOps)
                logger.info(`Upserted ${bulkOps.length} resources`)
            }
        },
    } satisfies ModuleConfig
}
