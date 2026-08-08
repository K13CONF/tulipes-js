import crypto from "node:crypto"
import ms from "ms"
import config from "@config/app.config.js"
import { generateJWTTokens, verifyRefreshToken, type JWTTokens } from "@helpers/jwt/index.js"
import { getRedis } from "@lib/redis.js"
import { Authenticable, type Principal } from "./authenticable.js"
import { InvalidRefreshTokenError } from "./errors.js"

/**
 * Token lifecycle — the one place tokens are issued, rotated, and revoked.
 *
 * Access tokens stay **stateless** (short-lived, verified by signature alone).
 * Refresh tokens are **stateful**: each pair carries a `jti` whose presence in
 * Redis is the token's liveness — rotation and logout delete it, so a stolen
 * refresh token dies the moment it is used twice or the caller logs out.
 */

/** Redis key holding a live refresh token's principal, expiring with the token. */
const refreshKey = (jti: string): string => `auth:rt:${jti}`

/** Refresh lifetime in seconds — Redis TTLs mirror the JWT expiry exactly.
 *  Read lazily: this module is loaded while app.config is still initializing
 *  (it sits on the module-registry import path), so no config at import time. */
const refreshTtlSeconds = (): number => Math.floor(ms(config.app.lib.jwt.refreshExpiresIn) / 1000)

/**
 * Mints an access + refresh pair for a principal and parks the refresh `jti`
 * in Redis. One `jti` per pair: the refresh token is the revocable artifact,
 * and the access token carries the same id so logout can revoke its sibling.
 */
export async function issueTokens(principal: Principal): Promise<JWTTokens> {
    const jti = crypto.randomUUID()
    const tokens = generateJWTTokens({
        sub: principal.id,
        model: principal.model,
        roles: principal.roles,
        jti,
    })

    await getRedis().set(
        refreshKey(jti),
        JSON.stringify({ model: principal.model, id: principal.id }),
        "EX",
        refreshTtlSeconds(),
    )
    return tokens
}

/**
 * Exchanges a refresh token for a fresh pair — single use. The old `jti` is
 * consumed atomically (GETDEL), so a replayed refresh token loses the race and
 * fails. The principal is reloaded from the database: refresh is the sync point
 * where role changes, deactivation, and soft deletion take effect.
 */
export async function rotateTokens(refreshToken: string): Promise<JWTTokens> {
    // 1. Signature, expiry, and kind (a stolen *access* token can't refresh).
    let payload
    try {
        payload = verifyRefreshToken(refreshToken)
    } catch {
        throw new InvalidRefreshTokenError()
    }

    // 2. Liveness: consume the jti in one atomic step — check and revoke together.
    const jti = typeof payload.jti === "string" ? payload.jti : null
    if (!jti || !(await getRedis().getdel(refreshKey(jti)))) {
        throw new InvalidRefreshTokenError()
    }

    // 3. The account must still exist, be active, and not be soft-deleted.
    const principal = await Authenticable.resolvePrincipal(String(payload.model), String(payload.sub))
    if (!principal) throw new InvalidRefreshTokenError()

    return issueTokens(principal)
}

/** Revokes a pair's refresh token (logout). Idempotent — deleting twice is fine. */
export async function revokeTokens(jti: string): Promise<void> {
    await getRedis().del(refreshKey(jti))
}
