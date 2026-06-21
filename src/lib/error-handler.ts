import type { ErrorRequestHandler } from "express"
import { ZodError } from "zod"

/**
 * Central error handler. Validation errors forwarded by `.validate()` become a
 * 400 with the formatted zod issues; anything else is a 500 (or `err.status`
 * when present). Must be registered last, after all routes.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ZodError) {
        return res.status(400).json({
            error: "ValidationError",
            issues: err.issues.map((issue) => ({
                path: issue.path.join("."),
                message: issue.message,
            })),
        })
    }

    const status = typeof err?.status === "number" ? err.status : 500
    return res.status(status).json({
        error: err?.message ?? "Internal Server Error",
    })
}
