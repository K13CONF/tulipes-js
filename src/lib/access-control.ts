import type { RequestHandler } from "express"
import { ForbiddenError, UnauthorizedError } from "./errors.js"
import "@/types/express.augment.js"

/**
 * App-level access-control policy. This lives in `lib` (not the acl package)
 * because it is meant to be customised per application — change how callers are
 * authenticated and how authorization decisions are made here.
 */

/**
 * Builds the RAI-enforcement middleware factory, bound to the merged ACL.
 * `authorize(rai)` returns a middleware that only lets the request through when
 * one of the caller's roles has been granted that RAI; otherwise it forwards a
 * unified `UnauthorizedError` / `ForbiddenError` to the central error handler.
 */
export function createAuthorize(acl: ReadonlyMap<string, readonly string[]>) {
    // role -> set of granted RAIs, for O(1) lookups
    const grantsByRole = new Map<string, Set<string>>()
    for (const [role, rais] of acl) {
        grantsByRole.set(role, new Set(rais))
    }

    return function authorize(rai: string): RequestHandler {
        return (req, _res, next) => {
            if (!req.auth) {
                return next(new UnauthorizedError())
            }
            const allowed = req.auth.roles.some((role) => grantsByRole.get(role)?.has(rai))
            if (!allowed) {
                return next(new ForbiddenError(`Access to "${rai}" is not permitted`, { rai }))
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
