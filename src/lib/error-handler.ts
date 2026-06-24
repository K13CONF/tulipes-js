import type { ErrorRequestHandler, Request, Response } from "express"
import { ZodError } from "zod"
import { HttpError } from "@packages/acl/errors.js"
import { buildEnvelope, type ErrorEntry } from "@packages/acl/response.js"
import { logger } from "@config/logger.js"
import "@/types/express.augment.js"

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
    // Known application errors carry their own status and code.
    if (err instanceof HttpError) {
        return send(res, err.status, [
            { code: err.code, message: localize(req, err.code, err.message, err.details) },
        ])
    }

    // Validation errors forwarded by `.validate()` — one entry per field issue.
    if (err instanceof ZodError) {
        return send(
            res,
            400,
            err.issues.map((issue) => ({
                code: "VALIDATION_ERROR",
                message: issue.message,
                path: issue.path.join("."),
            })),
        )
    }

    // Anything else is unexpected: log it (with request context), don't leak internals.
    ;(req.log ?? logger).error({ err }, "Unhandled error")
    return send(res, 500, [
        { code: "INTERNAL_SERVER_ERROR", message: localize(req, "INTERNAL_SERVER_ERROR", "Internal Server Error") },
    ])
}

/**
 * Emits the unified error envelope. Uses `res.respondError` (the responder
 * middleware), falling back to a raw write for errors thrown before that
 * middleware ran — in which case the raw senders aren't blocked yet.
 */
function send(res: Response, status: number, errors: ErrorEntry[]): void {
    if (typeof res.respondError === "function") {
        res.respondError(status, errors)
        return
    }
    res.status(status).json(buildEnvelope({ isOk: false, errors }))
}
