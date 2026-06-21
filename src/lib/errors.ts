/**
 * Application error hierarchy.
 *
 * Throwing (or `next(...)`-ing) an `HttpError` lets the central error handler
 * produce a single, unified error envelope:
 *
 *   { "error": { "code": string, "message": string, "details"?: unknown } }
 *
 * Never write an error response inline (`res.status(...).json(...)`) — always
 * forward an error so the format stays consistent across the whole app.
 */
export class HttpError extends Error {
    /** HTTP status code to respond with. */
    public readonly status: number
    /** Stable, machine-readable error code (e.g. "FORBIDDEN"). */
    public readonly code: string
    /** Optional structured context (e.g. the offending RAI, field issues). */
    public readonly details?: unknown

    constructor(status: number, code: string, message: string, details?: unknown) {
        super(message)
        this.name = new.target.name
        this.status = status
        this.code = code
        if (details !== undefined) {
            this.details = details
        }
        // Keep a clean stack trace where supported (V8).
        Error.captureStackTrace?.(this, new.target)
    }
}

/** 400 — the request was malformed or failed validation. */
export class BadRequestError extends HttpError {
    constructor(message = "Bad request", details?: unknown) {
        super(400, "BAD_REQUEST", message, details)
    }
}

/** 401 — the request is not authenticated. */
export class UnauthorizedError extends HttpError {
    constructor(message = "Authentication required", details?: unknown) {
        super(401, "UNAUTHORIZED", message, details)
    }
}

/** 403 — authenticated, but not permitted to access the resource. */
export class ForbiddenError extends HttpError {
    constructor(message = "Insufficient permissions", details?: unknown) {
        super(403, "FORBIDDEN", message, details)
    }
}

/** 404 — the requested resource was not found. */
export class NotFoundError extends HttpError {
    constructor(message = "Resource not found", details?: unknown) {
        super(404, "NOT_FOUND", message, details)
    }
}
