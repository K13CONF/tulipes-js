import type { RequestHandler } from "express"
import { ForbiddenError, UnauthorizedError } from "@packages/acl/errors.js"
import { publicRoleNames } from "@config/roles.definition.js"
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
            // The public role(s) are the baseline everyone gets; an authenticated
            // caller adds their own roles on top. A request with no auth context
            // is treated as the public/guest role.
            const effectiveRoles = req.auth?.roles?.length
                ? [...req.auth.roles, ...publicRoleNames]
                : publicRoleNames

            const allowed = effectiveRoles.some((role) => grantsByRole.get(role)?.has(rai))
            if (allowed) {
                return next()
            }

            // Not permitted: an unauthenticated caller needs to log in (401);
            // an authenticated one simply lacks the permission (403).
            if (!req.auth) {
                return next(new UnauthorizedError())
            }
            return next(new ForbiddenError(`Access to "${rai}" is not permitted`, { rai }))
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
