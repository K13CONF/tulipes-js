import type { ErrorRequestHandler } from "express"
import { ZodError } from "zod"
import { HttpError } from "@packages/acl/errors.js"

/** The single error envelope returned for every error response. */
interface ErrorBody {
    error: {
        code: string
        message: string
        details?: unknown
    }
}

/**
 * Central error handler — the only place that writes an error response, so the
 * format stays unified. Handles our `HttpError` hierarchy and zod validation
 * errors forwarded by `.validate()`; everything else becomes a 500 (and is
 * logged server-side). Must be registered last, after all routes.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    // Known application errors carry their own status, code and details.
    if (err instanceof HttpError) {
        const body: ErrorBody = { error: { code: err.code, message: err.message } }
        if (err.details !== undefined) {
            body.error.details = err.details
        }
        return res.status(err.status).json(body)
    }

    // Validation errors forwarded by `.validate()`.
    if (err instanceof ZodError) {
        const body: ErrorBody = {
            error: {
                code: "VALIDATION_ERROR",
                message: "Request validation failed",
                details: err.issues.map((issue) => ({
                    path: issue.path.join("."),
                    message: issue.message,
                })),
            },
        }
        return res.status(400).json(body)
    }

    // Anything else is unexpected: log it, don't leak internals.
    console.error("❌ Unhandled error:", err)
    const body: ErrorBody = {
        error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Internal Server Error",
        },
    }
    return res.status(500).json(body)
}
