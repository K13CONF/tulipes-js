import type { RequestHandler } from "express"
import { buildEnvelope, type RespondOptions, type Responder } from "@packages/acl/response.js"
import "@/types/express.augment.js"

/**
 * App-level response helper.
 *
 * Adds `res.respond()` to every response — the convenience for sending the
 * unified `{ isOk, data, errors, meta }` envelope. Nothing is restricted: the
 * full Express `Response` (`res.json`, `res.send`, …) keeps working; `respond`
 * is purely additive. Register it before the route handlers.
 */
export const responder: RequestHandler = (_req, res, next) => {
    res.respond = ((data?: unknown, options: RespondOptions = {}) => {
        // Explicit `{ status }` wins; otherwise honor an already-set status code
        // (e.g. `res.status(201).respond(...)`), defaulting to 200.
        res.status(options.status ?? res.statusCode).json(buildEnvelope({ isOk: true, data, meta: options.meta }))
    }) as Responder

    next()
}
