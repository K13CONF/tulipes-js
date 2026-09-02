/**
 * What the auth module offers other modules. Imported by package name:
 *
 *   import { requireAuth, requirePermission } from "@app/auth";
 */
export { requireAuth, requirePermission } from "./helpers/guards.js";
export { principal, GUEST, type Principal } from "./helpers/principal.js";
export { hashPassword, setPassword, verifyPassword } from "./helpers/passwords.js";
