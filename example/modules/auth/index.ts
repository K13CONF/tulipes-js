/**
 * What the auth module offers other modules.
 *
 * No guards: routes are gated by `ctx.rai({ id })`, which core enforces at
 * boot. Auth's contribution is resolving who the caller is.
 */
export { principal, GUEST, type Principal } from "./helpers/principal.js";
export { hashPassword, setPassword, verifyPassword } from "./helpers/passwords.js";
