import express, { type Express } from "express"
import config from "@/config/app.config.js"
import { mountModuleRoutes } from "@packages/acl/mount-routes.js"
import { authenticate, createAuthorize } from "./access-control.js"
import { errorHandler } from "./error-handler.js"
import { requestLogger } from "./request-logger.js"
import { i18nextMiddleware } from "./i18n.js"

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

    // Internationalization: detect language and attach `req.t`.
    app.use(i18nextMiddleware)

    // Authentication: populate req.auth (placeholder until JWT)
    app.use(authenticate)

    // RAI enforcement bound to the merged ACL
    const authorize = createAuthorize(config.app.acl)

    // Mount every module's routes. Most live under /<prefix>/<version> (e.g.
    // /api/v1); routes flagged `.root()` mount at the bare path instead.
    const basePath = `${config.app.api.prefix}/${config.app.api.version}`
    for (const module of Object.values(config.app.modules)) {
        const prefixed = module.routes.filter((route) => !route.root)
        const unprefixed = module.routes.filter((route) => route.root)

        if (prefixed.length) app.use(basePath, mountModuleRoutes(prefixed, authorize))
        if (unprefixed.length) app.use(mountModuleRoutes(unprefixed, authorize))
    }

    // Central error handler — must be registered last
    app.use(errorHandler)

    return app
}
