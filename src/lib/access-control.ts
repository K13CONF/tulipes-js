import mongoose from "mongoose"
import jwt from "jsonwebtoken"
import type { Request, RequestHandler } from "express"
import { publicRoleNames } from "@config/roles.definition.js"
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@packages/acl/errors.js"
import type { RAI } from "@packages/acl/types.js";
import type { IResource } from "@modules/core/models/resource.model.js";
import { verifyAccessToken } from "@helpers/jwt/index.js"
import { AccessTokenExpiredError } from "@modules/auth/helpers/errors.js"

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
 * Extracts the raw access token from the `Authorization: Bearer` header —
 * the sole credential transport.
 */
function extractAccessToken(req: Request): string | undefined {
    const header = req.header("authorization")
    if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length).trim()
    return undefined
}

/**
 * Authentication: verifies the JWT access token and populates `req.auth` with
 * the token's principal — no database hit on the request path (roles ride in
 * the token; `/auth/refresh` is where they re-sync with the database).
 *
 * A request with no token stays anonymous (`authorize()` applies the public
 * role). A request with a *bad* token fails outright — a presented credential
 * is never silently downgraded to anonymous.
 */
export const authenticate: RequestHandler = (req, _res, next) => {
    const token = extractAccessToken(req)
    if (!token) return next()

    try {
        const payload = verifyAccessToken(token)
        req.auth = {
            model: String(payload.model),
            id: String(payload.sub),
            roles: Array.isArray(payload.roles) ? payload.roles : [],
            ...(typeof payload.jti === "string" ? { jti: payload.jti } : {}),
        }
        return next()
    } catch (error) {
        // Expired gets its own code so clients know to refresh, not re-login.
        if (error instanceof jwt.TokenExpiredError) return next(new AccessTokenExpiredError())
        return next(new UnauthorizedError())
    }
}
