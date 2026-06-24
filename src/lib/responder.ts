import type { RequestHandler, Response } from "express"
import { buildEnvelope, type ErrorEntry, type ResponseMeta, type RespondOptions, type Responder } from "@packages/acl/response.js"
import "@/types/express.augment.js"

/**
 * App-level response policy.
 *
 * Attaches the unified responder to `res` and blocks the raw senders, so every
 * response leaves through one envelope (see `@packages/acl/response`). Register
 * this just before the route handlers — framework middleware above it (parser,
 * i18n, auth) keeps a normal `res`; only handler code is constrained.
 */

/** Raw senders blocked in handler code — everything goes through `res.respond()`. */
const BLOCKED_SENDERS = ["json", "jsonp", "send", "sendFile", "sendStatus"] as const

export const responder: RequestHandler = (_req, res, next) => {
    // Send a unified success envelope.
    res.respond = ((data?: unknown, options: RespondOptions = {}) => {
        writeEnvelope(res, options.status ?? 200, buildEnvelope({ isOk: true, data, meta: options.meta }))
    }) as Responder

    // Used by the central error handler to emit the same envelope for failures.
    res.respondError = (status: number, errors: ErrorEntry[], meta?: ResponseMeta) => {
        writeEnvelope(res, status, buildEnvelope({ isOk: false, errors, meta }))
    }

    // Block the raw senders. We write bodies via `res.end` below, so blocking
    // these never affects our own writers (or Express/pino internals).
    for (const name of BLOCKED_SENDERS) {
        Reflect.set(res, name, () => {
            throw new Error(`res.${name}() is blocked — use res.respond() so every response stays unified`)
        })
    }

    next()
}

/** Writes the envelope as JSON via `res.end`, bypassing the blocked senders. */
function writeEnvelope(res: Response, status: number, body: unknown): void {
    if (res.headersSent) return
    res.status(status).set("Content-Type", "application/json; charset=utf-8")
    res.end(JSON.stringify(body))
}
