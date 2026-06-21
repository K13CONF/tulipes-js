import { Router, type RequestHandler } from "express"
import type { HttpMethod, RouteRecord } from "./define-routes.js"
import "@/types/express.augment.js"

/**
 * Builds the RAI-enforcement middleware factory, bound to the merged ACL.
 * `authorize(rai)` returns a middleware that only lets the request through when
 * one of the caller's roles has been granted that RAI.
 */
export function createAuthorize(acl: ReadonlyMap<string, readonly string[]>) {
    // role -> set of granted RAIs, for O(1) lookups
    const grantsByRole = new Map<string, Set<string>>()
    for (const [role, rais] of acl) {
        grantsByRole.set(role, new Set(rais))
    }

    return function authorize(rai: string): RequestHandler {
        return (req, res, next) => {
            if (!req.auth) {
                return res.status(401).json({ error: "Unauthorized" })
            }
            const allowed = req.auth.roles.some((role) => grantsByRole.get(role)?.has(rai))
            if (!allowed) {
                return res.status(403).json({ error: "Forbidden", rai })
            }
            return next()
        }
    }
}

/**
 * Placeholder authentication: populates `req.auth` from an `x-roles` header
 * (comma-separated role names).
 *
 * TODO: replace with real JWT verification using `config.lib.jwt`.
 */
export const authenticate: RequestHandler = (req, _res, next) => {
    const header = req.header("x-roles")
    if (header) {
        req.auth = { roles: header.split(",").map((role) => role.trim()).filter(Boolean) }
    }
    next()
}

// Maps our HttpMethod onto the matching Express router method name.
const METHOD_FN = {
    GET: "get",
    POST: "post",
    PUT: "put",
    DELETE: "delete",
    PATCH: "patch",
} as const satisfies Record<HttpMethod, keyof Pick<Router, "get" | "post" | "put" | "delete" | "patch">>

/**
 * Mounts a module's collected routes onto a fresh Express Router, prepending the
 * RAI-enforcement guard before each route's own middlewares and handler.
 */
export function mountModuleRoutes(
    routes: readonly RouteRecord[],
    authorize: (rai: string) => RequestHandler,
): Router {
    const router = Router()
    for (const route of routes) {
        const handlers: RequestHandler[] = [authorize(route.rai), ...route.middlewares]
        if (route.handler) handlers.push(route.handler)
        router[METHOD_FN[route.method]](route.path, ...handlers)
    }
    return router
}
