import type { ErrorRequestHandler, Request } from "express"
import { ZodError } from "zod"
import { HttpError } from "@packages/acl/errors.js"
import { logger } from "@config/logger.js"

/** The single error envelope returned for every error response. */
interface ErrorBody {
    error: {
        code: string
        message: string
        details?: unknown
    }
}

/**
 * Localizes an error message via i18next (`req.t`, attached by the i18n
 * middleware) using the key `errors.<CODE>`. The original message is supplied as
 * `defaultValue`, so this is a no-op fallback when the translation — or `req.t`
 * itself (e.g. an error thrown before the i18n middleware ran) — is missing.
 * Any plain-object `details` is passed through as interpolation values, so a
 * translation like `"Access to {{rai}} is not permitted"` resolves correctly.
 */
function localize(req: Request, code: string, fallback: string, details?: unknown): string {
    if (typeof req.t !== "function") return fallback
    const values =
        details && typeof details === "object" && !Array.isArray(details)
            ? (details as Record<string, unknown>)
            : {}
    return req.t(`errors.${code}`, { defaultValue: fallback, ...values })
}

/**
 * Central error handler — the only place that writes an error response, so the
 * format stays unified. Handles our `HttpError` hierarchy and zod validation
 * errors forwarded by `.validate()`; everything else becomes a 500 (and is
 * logged server-side). Messages are localized per request via `req.t`. Must be
 * registered last, after all routes.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    // Known application errors carry their own status, code and details.
    if (err instanceof HttpError) {
        const body: ErrorBody = {
            error: { code: err.code, message: localize(req, err.code, err.message, err.details) },
        }
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
                message: localize(req, "VALIDATION_ERROR", "Request validation failed"),
                details: err.issues.map((issue) => ({
                    path: issue.path.join("."),
                    message: issue.message,
                })),
            },
        }
        return res.status(400).json(body)
    }

    // Anything else is unexpected: log it (with request context), don't leak internals.
    ;(req.log ?? logger).error({ err }, "Unhandled error")
    const body: ErrorBody = {
        error: {
            code: "INTERNAL_SERVER_ERROR",
            message: localize(req, "INTERNAL_SERVER_ERROR", "Internal Server Error"),
        },
    }
    return res.status(500).json(body)
}
