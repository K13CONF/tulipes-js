import express, { type Express } from "express"
import config from "@/config/app.config.js"
import { mountModuleRoutes } from "@packages/acl/mount-routes.js"
import { authenticate, createAuthorize } from "./access-control.js"
import { errorHandler } from "./error-handler.js"
import { requestLogger } from "./request-logger.js"

/**
 * Creates and configures the Express application from the resolved global
 * config: body parsing, authentication, every module's routes mounted under the
 * API prefix with RAI enforcement, and the central error handler.
 */
export function createApp(): Express {
    const app = express()

    // Per-request logging first, so every request (incl. errors) is captured.
    app.use(requestLogger)

    // Body parsing (needed for `.validate({ body })`)
    app.use(express.json())

    // Authentication: populate req.auth (placeholder until JWT)
    app.use(authenticate)

    // RAI enforcement bound to the merged ACL
    const authorize = createAuthorize(config.app.acl)

    // Mount every module's routes under /<prefix>/<version>, e.g. /api/v1
    const basePath = `${config.app.api.prefix}/${config.app.api.version}`
    for (const module of Object.values(config.app.modules)) {
        app.use(basePath, mountModuleRoutes(module.routes, authorize))
    }

    // Central error handler — must be registered last
    app.use(errorHandler)

    return app
}
