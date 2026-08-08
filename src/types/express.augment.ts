/**
 * Ambient augmentation of Express's `Request`/`Response`.
 *
 * `req.auth` is populated by the `authenticate` middleware and consumed by the
 * RAI-enforcement (`authorize`) middleware. `res.respond` is added by the
 * `responder` middleware as a convenience for the unified envelope.
 */
import type { RAI } from "@packages/acl/types.js";
import type { Responder } from "@packages/acl/response.js"

/** Authenticated caller context attached to each request. */
export interface AuthContext {
    /** Mongoose model name of the authenticated account (e.g. "User") — the
     *  Authenticable registry decides which models can appear here. */
    model: string
    /** The account's document id. */
    id: string
    /** Role names the caller holds (matched against the merged ACL). */
    roles: string[]
    /** The token pair's id — lets logout revoke the sibling refresh token. */
    jti?: string
}

declare global {
    namespace Express {
        interface Request {
            auth?: AuthContext
            rai?: RAI
        }
        interface Response {
            /** Send a unified success envelope. Additive — the raw senders still work. */
            respond: Responder
        }
    }
}
