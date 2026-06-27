import { Router, type RequestHandler } from "express"
import type { HttpMethod, RouteRecord } from "./define-routes.js"

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
 * RAI-enforcement guard (built by the app's `createAuthorize`) before each
 * route's own middlewares and handler.
 */
export function mountModuleRoutes(
    routes: readonly RouteRecord[],
    is_enabled: (rai: string) => RequestHandler,
    authorize: (rai: string) => RequestHandler,
): Router {
    const router = Router()
    for (const route of routes) {
        const handlers: RequestHandler[] = [is_enabled(route.rai), authorize(route.rai), ...route.middlewares]
        if (route.handler) handlers.push(route.handler)
        router[METHOD_FN[route.method]](route.path, ...handlers)
    }
    return router
}
