/**
 * Ambient augmentation of Express's `Request`/`Response`.
 *
 * `req.auth` is populated by the `authenticate` middleware and consumed by the
 * RAI-enforcement (`authorize`) middleware. `res.respond` is added by the
 * `responder` middleware as a convenience for the unified envelope.
 */
import type { Responder } from "@packages/acl/response.js"

/** Authenticated caller context attached to each request. */
export interface AuthContext {
    /** Role names the caller holds (matched against the merged ACL). */
    roles: string[]
}

declare global {
    namespace Express {
        interface Request {
            auth?: AuthContext
            /** i18next translation function, attached by `i18next-http-middleware`. */
            t?: (key: string, options?: Record<string, unknown>) => string
        }
        interface Response {
            /** Send a unified success envelope. Additive — the raw senders still work. */
            respond: Responder
        }
    }
}
