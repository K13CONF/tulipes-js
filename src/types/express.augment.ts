/**
 * Ambient augmentation of Express's `Request` with the authenticated context.
 * `req.auth` is populated by the `authenticate` middleware and consumed by the
 * RAI-enforcement (`authorize`) middleware.
 */

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
    }
}
