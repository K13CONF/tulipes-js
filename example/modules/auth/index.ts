/**
 * What the auth module offers other modules.
 *
 * No guards: routes are gated by `ctx.rai({ id })`, which core enforces at
 * boot. Auth's contribution is resolving who the caller is — `req.auth`.
 */
export { auth, currentUser, GUEST, type Auth } from "./helpers/auth.js";
export { hashPassword, setPassword, verifyPassword } from "./helpers/passwords.js";
export { endAllSessions, endSession, listSessions } from "./helpers/tokens.js";
