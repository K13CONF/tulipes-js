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
        res.status(options.status ?? 200).json(buildEnvelope({ isOk: true, data, meta: options.meta }))
    }) as Responder

    next()
}
