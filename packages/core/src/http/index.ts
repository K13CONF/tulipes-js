export {
  HttpError,
  ValidationError,
  errorHandler,
  notFoundHandler,
  type FieldIssue,
  type HttpErrorOptions,
} from "./error-handler.ts";
export {
  buildMeta,
  envelope,
  type ApiError,
  type Envelope,
  type MetaAction,
  type MetaActions,
  type ResponseMeta,
  type RespondOptions,
} from "./envelope.ts";
export {
  parsePage,
  type PageRequest,
  type PaginationBounds,
} from "./pagination.ts";
export { bindRespond, markResponded, warnOnRawResponse } from "./respond.ts";
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
} from "./rai.ts";
export { scanRoutes } from "./route-scan.ts";
export { isRai, parseRai, type Rai, type RaiParts } from "../acl/rai-id.ts";
export {
  codeOfIssue,
  fieldOf,
  type RouteSchemas,
  type SchemaIssue,
  type ValidatableSchema,
} from "./schema.ts";

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
  /**
   * The grant patterns this credential is limited to (`hello:web:*`,
   * `users:bo:list`, `*`), read from the stored credential, never from the
   * client. Absent means the role's full grant; a scope the role lacks
   * grants nothing, and `[]` reaches nothing.
   */
  scopes?: readonly string[];
  /**
   * The id of the credential behind this request when it is one its owner
   * can name and revoke — an API token's — never the secret. For audit
   * lines and for work that must stop when the credential is revoked.
   * Absent for a session.
   */
  credentialId?: string;
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
