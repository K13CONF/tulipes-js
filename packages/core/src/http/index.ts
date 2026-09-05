export { HttpError, errorHandler, notFoundHandler } from "./error-handler.js";
export {
  ANONYMOUS,
  createRai,
  GUEST_ROLE,
  RAI_TAG,
  roleOf,
  RouteRegistry,
  type AccessChecker,
  type RaiTag,
  type RouteInfo,
  type RouteRecord,
} from "./rai.js";
export { scanRoutes } from "./route-scan.js";

/**
 * Who is making a request. Core owns the shape and reads `req.auth`; an
 * auth module's only job is to put one there. Any scheme — JWT, sessions,
 * mTLS — plugs in by setting that one field.
 *
 * Declared in THIS module, not re-exported from another, because
 * TypeScript augmentation only merges with the module that declares an
 * interface. The two halves below are deliberately empty: core knows the
 * shape of the contract, the app's auth module fills in the types.
 *
 *   declare module "@tulipes/core/http" {
 *     interface AuthUser { _id: Types.ObjectId; email: string }
 *     interface AuthSession { sid: string; lastSeenAt: Date }
 *   }
 */
export interface Auth {
  /** True once an auth module has identified the caller. */
  isAuthenticated: boolean;
  /** The caller, or null for a guest. */
  user: AuthUser | null;
  /** This request's session, or null when there is none. */
  session: AuthSession | null;
}

/**
 * Both are empty here on purpose. Core reads exactly one thing off the
 * user — `role`, for the ACL check — and it does that through a cast in
 * `roleOf` rather than by declaring the field, so that an app can augment
 * `role` as a required `string` and have it typed that way everywhere. A
 * `role?: string` declared here would force every app to inherit the
 * optionality.
 *
 * An app whose roles do not live on the user — a claims service, a join
 * table — leaves both alone and replaces the decision instead, with
 * `ctx.routes.setAccessChecker()`.
 */
export interface AuthUser {}

export interface AuthSession {}
