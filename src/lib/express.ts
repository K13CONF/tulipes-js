import express, { type Express } from "express"
import config from "@/config/app.config.js"
import { mountModuleRoutes } from "@packages/acl/mount-routes.js"
import { authenticate, checkResourceEnabled, createAuthorize } from "./access-control.js"
import { errorHandler } from "./error-handler.js"
import { requestLogger } from "./request-logger.js"
import { i18nextMiddleware } from "./i18n.js"
import { responder } from "./responder.js"
import { corsMiddleware, helmetMiddleware, mongoSanitize, rateLimiter } from "./security.js"

/**
 * Creates and configures the Express application from the resolved global
 * config: edge security (headers, CORS, rate limiting), bounded body parsing,
 * authentication, every module's routes mounted under the API prefix with RAI
 * enforcement, and the central error handler.
 */
export function createApp(): Express {
    const app = express()

    // Behind a reverse proxy / load balancer: derive req.ip + protocol from the
    // X-Forwarded-* headers per config (conservative by default — never blindly
    // trust every hop, or rate-limit keys become spoofable).
    app.set("trust proxy", config.app.lib.security.trustProxy)
    // Don't advertise the framework.
    app.disable("x-powered-by")

    // Per-request logging first, so every request (incl. rejected ones) is captured.
    app.use(requestLogger)

    // Security headers on every response — before the limiter so even 429s carry them.
    app.use(helmetMiddleware)

    // CORS: sets headers and answers preflight (OPTIONS) before the limiter runs.
    app.use(corsMiddleware)

    // Rate limiting: reject abusive clients before we parse their body.
    app.use(rateLimiter)

    // Body parsing, size-bounded (needed for `.validate({ body })`).
    app.use(express.json({ limit: config.app.lib.security.bodyLimit }))

    // Strip Mongo operator keys ($, .) from inputs — defense-in-depth behind zod.
    app.use(mongoSanitize)

    // Internationalization: detect language and attach `req.t`.
    app.use(i18nextMiddleware)

    // Authentication: populate req.auth (placeholder until JWT)
    app.use(authenticate)

    // Unified responses: attach res.respond() and block the raw senders. Placed
    // after the framework middleware (which keep a normal res) and before routes,
    // so only handler code is constrained.
    app.use(responder)

    // RAI enforcement bound to the merged ACL
    const authorize = createAuthorize(config.app.acl)

    // Mount every module's routes. Most live under /<prefix>/<version> (e.g.
    // /api/v1); routes flagged `.root()` mount at the bare path instead.
    const basePath = `${config.app.api.prefix}/${config.app.api.version}`
    for (const module of Object.values(config.app.modules)) {
        const prefixed = module.routes.filter((route) => !route.root)
        const unprefixed = module.routes.filter((route) => route.root)

        if (prefixed.length) app.use(basePath, mountModuleRoutes(prefixed, checkResourceEnabled, authorize))
        if (unprefixed.length) app.use(mountModuleRoutes(unprefixed, checkResourceEnabled, authorize))
    }

    // Central error handler — must be registered last
    app.use(errorHandler)

    return app
}
