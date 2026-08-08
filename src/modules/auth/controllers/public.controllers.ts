import mongoose from "mongoose"
import type { z } from "zod"
import type { RouteHandler } from "@packages/acl/define-routes.js"
import { ConflictError, UnauthorizedError } from "@packages/acl/errors.js"
import { authenticateLocal } from "../helpers/passport.js"
import { issueTokens, rotateTokens, revokeTokens } from "../helpers/token.service.js"
import { Authenticable } from "../helpers/authenticable.js"
import { InvalidRefreshTokenError } from "../helpers/errors.js"
import type { loginSchema, refreshSchema, registerSchema } from "../schemas/public.schemas.js"
import type { IUser } from "@modules/users/models/user.model.js"

type LoginBody = z.infer<typeof loginSchema>
type RefreshBody = z.infer<typeof refreshSchema>
type RegisterBody = z.infer<typeof registerSchema>

/**
 * POST /auth/login — credentials in, JWT pair out, returned in the body.
 */
export const login: RouteHandler<{}, LoginBody> = async (req, res) => {
    // 1. Credentials → Principal (rejects with INVALID_CREDENTIALS on mismatch).
    const principal = await authenticateLocal(req, res)

    // 2. Principal → token pair; the refresh jti is now live in Redis.
    const tokens = await issueTokens(principal)

    return res.respond({ tokenType: "Bearer", ...tokens, principal })
}

/**
 * POST /auth/refresh — exchanges a live refresh token for a new pair (single
 * use, rotated).
 */
export const refresh: RouteHandler<{}, RefreshBody> = async (req, res) => {
    const presented = req.body?.refreshToken
    if (!presented) throw new InvalidRefreshTokenError()

    const tokens = await rotateTokens(presented)

    return res.respond({ tokenType: "Bearer", ...tokens })
}

/**
 * POST /auth/logout — revokes the refresh token (the durable credential). The
 * short-lived access token is left to expire on its own — that's the
 * stateless-JWT trade-off, bounded by JWT_EXPIRES_IN.
 */
export const logout: RouteHandler = async (req, res) => {
    if (req.auth?.jti) await revokeTokens(req.auth.jti)

    return res.respond(null, { meta: { action: "logged-out" } })
}

/**
 * GET /auth/me — the caller's identity, resolved fresh from the database (the
 * token's roles may be stale; this endpoint reports the current truth).
 */
export const me: RouteHandler = async (req, res) => {
    // authorize() guarantees req.auth here — no anonymous caller holds this RAI.
    const principal = req.auth && (await Authenticable.resolvePrincipal(req.auth.model, req.auth.id))
    if (!principal) throw new UnauthorizedError()

    return res.respond({ principal })
}

/**
 * POST /auth/register — creates an account on the User model with the default
 * "user" role. Registration is inherently model-specific (its fields belong to
 * one schema), so unlike login it does not iterate the Authenticable registry —
 * adapt the target model per application.
 */
export const register: RouteHandler<{}, RegisterBody> = async (req, res) => {
    const UserModel = mongoose.model<IUser>("User")
    const { email, username } = req.body

    // Friendly pre-check; the partial unique indexes stay the race-proof guard.
    const clash = await UserModel.exists({
        $or: [{ email }, ...(username ? [{ username }] : [])],
    })
    if (clash) throw new ConflictError("An account with this email or username already exists")

    try {
        // create() runs the save path — the Authenticable pre-save hook hashes
        // the password. Never seed accounts through updates/upserts. Optional
        // fields are spread conditionally (exactOptionalPropertyTypes).
        const user = await UserModel.create({
            email,
            password: req.body.password,
            roles: ["user"],
            ...(username ? { username } : {}),
            ...(req.body.first_name ? { first_name: req.body.first_name } : {}),
            ...(req.body.last_name ? { last_name: req.body.last_name } : {}),
        })

        // Respond with a hand-picked projection — never echo the document.
        return res.respond(
            { id: String(user._id), email: user.email, roles: user.roles },
            { status: 201 },
        )
    } catch (error) {
        // A concurrent registration can still trip the unique index (E11000).
        if (error instanceof Error && "code" in error && error.code === 11000) {
            throw new ConflictError("An account with this email or username already exists")
        }
        throw error
    }
}
