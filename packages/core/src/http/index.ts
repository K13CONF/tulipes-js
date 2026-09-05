export { HttpError, errorHandler, notFoundHandler } from "./error-handler.js";
export {
  ANONYMOUS,
  createRai,
  RAI_TAG,
  RouteRegistry,
  type AccessChecker,
  type RaiTag,
  type RouteInfo,
  type RouteRecord,
} from "./rai.js";
export { scanRoutes } from "./route-scan.js";

/**
 * Who is making a request. Core owns the shape and reads `req.principal`;
 * an auth module's only job is to put one there. Any scheme — JWT,
 * sessions, mTLS — plugs in by setting that one field.
 *
 * Declared in THIS module, not re-exported from another, because
 * TypeScript augmentation only merges with the module that declares an
 * interface. An auth module adds its own fields like so:
 *
 *   declare module "@tulipes/core/http" {
 *     interface Principal { jti?: string }
 *   }
 */
export interface Principal {
  id?: string;
  email?: string;
  role: string;
  authenticated: boolean;
}
