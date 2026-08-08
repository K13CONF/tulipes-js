import { HttpError } from "@packages/acl/errors.js"

/**
 * Auth-specific errors. They extend the shared `HttpError` hierarchy so the
 * central error handler renders them into the unified envelope, localized via
 * the `errors.<CODE>` keys (core i18n namespace).
 */

/** 401 — the identifier/password pair matched no authenticatable account. */
export class InvalidCredentialsError extends HttpError {
    constructor(message = "Invalid credentials", details?: unknown) {
        super(401, "INVALID_CREDENTIALS", message, details)
    }
}

/**
 * 401 — the presented access token is well-formed but expired. Carries its own
 * code (distinct from UNAUTHORIZED) so clients know to call `/auth/refresh`
 * instead of re-prompting for credentials.
 */
export class AccessTokenExpiredError extends HttpError {
    constructor(message = "Access token expired", details?: unknown) {
        super(401, "TOKEN_EXPIRED", message, details)
    }
}

/** 401 — the refresh token is invalid, expired, revoked, or already rotated. */
export class InvalidRefreshTokenError extends HttpError {
    constructor(message = "Invalid or expired refresh token", details?: unknown) {
        super(401, "INVALID_REFRESH_TOKEN", message, details)
    }
}
