/**
 * What the auth module offers other modules.
 *
 * No guards: routes are gated by `ctx.rai({ id })`, which core enforces at
 * boot. Auth's contribution is resolving who the caller is — `req.auth`.
 */
export { auth, currentUser, GUEST, type Auth } from "../helpers/auth.ts";
export { hashPassword, setPassword, verifyPassword } from "../helpers/passwords.ts";
export { endAllSessions, endSession, listSessions } from "../helpers/tokens.ts";
/** Call after writing a user's role or deleting the user: cached identities carry the old authority. */
export { forgetSession, forgetUser } from "../helpers/session-cache.ts";
export { createAccessCheck } from "../helpers/access-check.ts";
/** The actor behind a bearer credential, outside a request — what `config/mcp.config.ts` identifies with. */
export { identifyCredential } from "../helpers/passport.ts";
