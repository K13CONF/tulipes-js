/**
 * Ambient augmentation of Express's `Request`/`Response`.
 *
 * `req.auth` is populated by the `authenticate` middleware and consumed by the
 * RAI-enforcement (`authorize`) middleware. `res.respond` / `res.respondError`
 * are attached by the `responder` middleware to emit the unified envelope.
 */
import type { Responder, ErrorResponder } from "@packages/acl/response.js"

/** Authenticated caller context attached to each request. */
export interface AuthContext {
    /** Role names the caller holds (matched against the merged ACL). */
    roles: string[]
}

declare global {
    namespace Express {
        interface Request {
            auth?: AuthContext
        }
        interface Response {
            /** Send a unified success envelope — the only sanctioned data sender. */
            respond: Responder
            /** Internal — used by the central error handler to emit an error envelope. */
            respondError: ErrorResponder
        }
    }
}
