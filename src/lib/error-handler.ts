import type { ErrorRequestHandler, Request, Response } from "express"
import { ZodError } from "zod"
import { BadRequestError, HttpError, PayloadTooLargeError } from "@packages/acl/errors.js"
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

    // Body-parser (express.json) failures carry a `type`: oversized body → 413,
    // malformed/unsupported JSON → 400. Map them to clean, localized envelopes.
    if (err && typeof err === "object" && "type" in err) {
        const type = (err as { type?: string }).type
        if (type === "entity.too.large") {
            const e = new PayloadTooLargeError()
            return send(res, e.status, [{ code: e.code, message: localize(req, e.code, e.message) }])
        }
        if (type === "entity.parse.failed" || type === "encoding.unsupported" || type === "charset.unsupported") {
            const e = new BadRequestError()
            return send(res, e.status, [{ code: e.code, message: localize(req, e.code, e.message) }])
        }
    }

    // Anything else is unexpected: log it (with request context), don't leak internals.
    ;(req.log ?? logger).error({ err }, "Unhandled error")
    return send(res, 500, [
        { code: "INTERNAL_SERVER_ERROR", message: localize(req, "INTERNAL_SERVER_ERROR", "Internal Server Error") },
    ])
}

/** Emits the unified error envelope `{ isOk:false, data:null, errors, meta:{} }`. */
function send(res: Response, status: number, errors: ErrorEntry[]): void {
    res.status(status).json(buildEnvelope({ isOk: false, errors }))
}
