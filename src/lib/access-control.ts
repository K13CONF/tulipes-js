import mongoose from "mongoose"
import type { RequestHandler } from "express"
import { publicRoleNames } from "@config/roles.definition.js"
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@packages/acl/errors.js"
import type { RAI } from "@packages/acl/types.js";
import type { IResource } from "@modules/core/models/resource.model.js";

/**
 * App-level access-control policy. This lives in `lib` (not the acl package)
 * because it is meant to be customised per application — change how callers are
 * authenticated and how authorization decisions are made here.
 */

/**
 * Check if the resource is enabled in the database. If it is not enabled, return a 404 error. 
 * If it is enabled add req.rai and call the next middleware.
 */
export function checkResourceEnabled(rai: RAI): RequestHandler {
    return async (req, _res, next) => {
        // 1. Load the resource from the database
        const Resource = mongoose.model<IResource>("Resource")
        const resource = await Resource.exists({ _id: rai, is_enabled: true }); // these two field are indexed, so this should be fast

        // 2. If the resource is not found or not enabled, return a 404 error
        if (!resource) {
            return next(new NotFoundError(`Resource "${rai}" is not found or disabled`, { rai }))
        }

        // 3. If the resource is found and enabled, add the rai to the request object and call the next middleware
        req.rai = rai
        
        return next();
    }
}

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
